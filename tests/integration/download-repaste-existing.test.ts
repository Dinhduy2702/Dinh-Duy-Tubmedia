import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QuarantineRepository } from '@main/database/repositories/quarantine-repository.js';
import { QuarantineService } from '@main/media/quarantine-service.js';
import { DownloadEngine } from '@main/downloader/download-engine.js';
import { builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { downloadLinkTag } from '@shared/utils/url.js';
import { downloadPolicyForWorkflow, settingsForDownloadWorkflow } from '@shared/utils/download-quality.js';
import type { AppSettings, MediaInfo, Project, QueueJob } from '@shared/types/domain.js';

// 2026-11-02 (người dùng báo): dán lại link đã tải vào ĐÚNG thư mục khoảng một ngày sau thì app lại tải tiếp / tạo lại bản dựng
// CapCut thay vì bỏ qua. Chạy DownloadEngine.run() thật trên CSDL thật và tệp thật trong os.tmpdir(); chỉ giả lập ffprobe
// (analyzer/verifier), yt-dlp và ffmpeg — đếm được engine có gọi tải lại / mã hoá lại hay không.

let folder = '';
let driveRoot = '';
let database: AppDatabase;
let projects: ProjectRepository;
let sources: MediaSourceRepository;
let quarantineItems: QuarantineRepository;
let engine: DownloadEngine;
let settings: AppSettings;
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
let toolsGet: ReturnType<typeof vi.fn>;
let ytdlpAvailable = false;
let brokenFiles = new Set<string>();
let ytdlpOutputTemplates: string[] = [];
/** P1: tệp tải về không có luồng tiếng (bộ phân tích giả trả audioCodec null). */
let noAudioStream = false;
/** P1: đỉnh âm lượng (dB) mà ffmpeg volumedetect giả đo được; null = đo không được. */
let measuredMaxVolumeDb: number | null = -3;
let measureAudio: ReturnType<typeof vi.fn>;
/** P2: dòng __VDMSP_FORMAT__ yt-dlp giả in ra (định dạng đã chọn); null = không in. */
let ytdlpFormatLine: string | null = null;
/** P3: codec tiếng của tệp yt-dlp giả tải về, và phần mở rộng tệp; ffmpeg giả ghi tệp mang dấu AAC_MARK (đã chuyển sang AAC). */
let downloadedAudioCodec = 'aac';
let ytdlpExt = 'mp4';
let ffmpegCalls: string[][] = [];
let ffmpegAvailable = false;
/** 1.7.4: mỗi lần mã hoá bản CapCut chờ promise này trước khi xong (đo số bản chạy cùng lúc); null = xong ngay. */
let encodeHold: (() => Promise<void>) | null = null;
/** P4: tệp nào có luồng hình bị hụt (bộ phân tích giả trả luồng hình 468,9 s trong khi tiếng 522,3 s). */
let shortVideo: (path: string) => boolean = () => false;
/** P4: các dòng yt-dlp giả in ra stderr. */
let ytdlpStderrLines: string[] = [];
const AAC_MARK = 'AACM';
const audioCodecOf = (path: string): string =>
  existsSync(path) && readFileSync(path).subarray(0, 4).toString() === AAC_MARK ? 'aac' : downloadedAudioCodec;

const mediaInfo = (fileSize: number): MediaInfo => ({
  duration: 522.3,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.0',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/15360',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 9_690_344,
  audioBitrate: 128_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  fileSize
});

const makeProject = (name: string, sourceFolder: string): Project =>
  projects.create({
    name,
    sourceFolder,
    tempFolder: join(folder, `temp-${name}`),
    outputFolder: join(driveRoot, 'thanh-pham'),
    finalFileName: name,
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });

const insertSource = (
  projectId: string,
  url: string,
  platform: string,
  mediaId: string,
  file: { path: string; policy: string } | null = null
): string => {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?)`
    )
    .run(
      id,
      `${platform}:${platform}:${mediaId}::project:${projectId}`,
      url,
      url,
      platform,
      platform,
      mediaId,
      file?.path ?? null,
      file?.policy ?? null,
      file ? 'valid' : 'unknown',
      file ? JSON.stringify(mediaInfo(4096)) : null,
      now,
      now
    );
  return id;
};

const jobFor = (projectId: string, sourceId: string, workflow: 'download-merge' | 'download-only'): QueueJob => ({
  id: randomUUID(),
  projectId,
  type: 'download',
  status: 'downloading',
  priority: 0,
  sourceId,
  itemId: null,
  input: workflow === 'download-merge' ? { workflow } : {},
  progress: 0,
  speed: null,
  etaSeconds: null,
  attempts: 0,
  maxAttempts: 3,
  errorCode: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: null
});

const writeVideo = (path: string, bytes = 4096): void => {
  writeFileSync(path, Buffer.alloc(bytes, 9));
};

const resource = builtInResourceProfiles.find((profile) => profile.id === 'resource-balanced') ?? builtInResourceProfiles[0]!;
const run = (job: QueueJob) => engine.run(job, resource, new AbortController().signal, () => undefined);
const eventCodes = (): string[] =>
  [...logger.info.mock.calls, ...logger.warn.mock.calls].map((call) => String(call[1]));

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-existing-reuse-'));
  driveRoot = join(folder, 'E');
  mkdirSync(driveRoot, { recursive: true });
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  sources = new MediaSourceRepository(database.db);
  quarantineItems = new QuarantineRepository(database.db);
  settings = { ...defaultAppSettings, cookiesFilePath: '', cookiesBrowser: 'none' };
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  ytdlpAvailable = false;
  brokenFiles = new Set<string>();
  ytdlpOutputTemplates = [];
  noAudioStream = false;
  measuredMaxVolumeDb = -3;
  ytdlpFormatLine = null;
  downloadedAudioCodec = 'aac';
  ytdlpExt = 'mp4';
  ffmpegCalls = [];
  ffmpegAvailable = false;
  encodeHold = null;
  shortVideo = () => false;
  ytdlpStderrLines = [];
  toolsGet = vi.fn((name: string) =>
    name === 'yt-dlp' && ytdlpAvailable
      ? { available: true, executablePath: join(folder, 'yt-dlp-gia.exe') }
      : name === 'ffmpeg' && ffmpegAvailable
        ? { available: true, executablePath: join(folder, 'ffmpeg-gia.exe') }
        : { available: false, executablePath: null }
  );
  const quarantine = new QuarantineService(logger as never, {
    items: quarantineItems,
    projects,
    rootOf: () => driveRoot
  });
  const analyzer = {
    analyze: vi.fn((path: string) =>
      Promise.resolve(
        noAudioStream
          ? { ...mediaInfo(4096), audioCodec: null, audioBitrate: null, sampleRate: null, channels: null, channelLayout: null }
          : {
              ...mediaInfo(4096),
              audioCodec: audioCodecOf(path),
              videoStreamDuration: shortVideo(path) ? 468.9 : 522.2,
              audioStreamDuration: 522.3
            }
      )
    )
  };
  measureAudio = vi.fn(() =>
    Promise.resolve(measuredMaxVolumeDb === null ? null : { meanVolumeDb: measuredMaxVolumeDb - 12, maxVolumeDb: measuredMaxVolumeDb })
  );
  const verifier = {
    verify: vi.fn((path: string, level: string) =>
      Promise.resolve(
        existsSync(path) && !brokenFiles.has(path)
          ? { ok: true, path, level, reasons: [], duration: 522.3 }
          : { ok: false, path, level, reasons: ['Tệp không tồn tại hoặc không đọc được.'], duration: 0 }
      )
    ),
    measureAudio
  };
  // yt-dlp giả: ghi tệp đúng theo mẫu -o engine truyền vào rồi báo đường dẫn như yt-dlp thật (__VDMSP_FILE__).
  const processes = {
    run: vi.fn((options: { tool?: string; args: string[]; onStdoutLine?: (line: string) => void; onStderrLine?: (line: string) => void }) => {
      if (options.tool === 'ffmpeg') {
        // ffmpeg giả: ghi tệp đích (tham số cuối) mang dấu AAC_MARK như thể đã chuyển tiếng sang AAC.
        ffmpegCalls.push(options.args);
        const finish = () => {
          writeFileSync(options.args.at(-1)!, Buffer.concat([Buffer.from(AAC_MARK), Buffer.alloc(4096, 5)]));
          return { code: 0, stdoutTail: '', stderrTail: '' };
        };
        if (encodeHold && options.args.some((arg) => arg.includes('.capcut-edit-'))) return encodeHold().then(finish);
        return Promise.resolve(finish());
      }
      const template = options.args[options.args.indexOf('-o') + 1] ?? '';
      ytdlpOutputTemplates.push(template);
      const name = template.replace(/%\((\w+)\)[.\d]*[sB]/g, (_match, field: string) =>
        field === 'ext' ? ytdlpExt : field === 'id' ? 'ID_TAI_LAI' : 'Ban tai lai'
      );
      // Như yt-dlp thật: mẫu tương đối nằm trong thư mục "home:" của --paths.
      const homeIndex = options.args.findIndex((arg, index) => options.args[index - 1] === '--paths' && arg.startsWith('home:'));
      const output = isAbsolute(name) || homeIndex < 0 ? name : join(options.args[homeIndex]!.slice('home:'.length), name);
      writeVideo(output, 5000);
      for (const line of ytdlpStderrLines) options.onStderrLine?.(line);
      if (ytdlpFormatLine) options.onStdoutLine?.(`__VDMSP_FORMAT__:${ytdlpFormatLine}`);
      options.onStdoutLine?.(`__VDMSP_FILE__:${output}`);
      return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '' });
    })
  };
  engine = new DownloadEngine(
    processes as never,
    { get: toolsGet } as never,
    sources,
    projects,
    { get: () => settings } as never,
    analyzer as never,
    verifier as never,
    quarantine,
    logger as never
  );
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});


const capcutSetup = (name: string, id: string) => {
  const own = join(driveRoot, 'DinhDuy', name, 'video');
  mkdirSync(own, { recursive: true });
  settings = { ...settings, downloadEditCopyMode: 'capcut_sdr_1080p' };
  ytdlpAvailable = true;
  ffmpegAvailable = true;
  toolsGet.mockImplementation((tool: string) =>
    tool === 'yt-dlp'
      ? { available: true, executablePath: join(folder, 'yt-dlp-gia.exe') }
      : tool === 'ffmpeg'
        ? { available: true, executablePath: join(folder, 'ffmpeg-gia.exe'), capabilities: ['aac', 'libx264', 'zscale', 'tonemap'] }
        : { available: false, executablePath: null }
  );
  const url = `https://www.youtube.com/watch?v=${id}`;
  const project = makeProject(name, own);
  return { own, url, project };
};
const mp4s = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.mp4')).sort();
const editsIn = (dir: string): string[] => mp4s(dir).filter((name) => name.includes('.capcut-edit-'));
const mastersIn = (dir: string): string[] => mp4s(dir).filter((name) => !name.includes('.capcut-edit-'));

describe('Phần 1 — nhớ video GỐC; tệp đã nhớ mất thì tìm lại trong thư mục trước khi tải lại', () => {
  it('tải xong có bản CapCut → bản ghi nguồn trỏ tới video GỐC, không phải bản CapCut', async () => {
    const { own, url, project } = capcutSetup('TA901', 'REPASTE0001');
    const sourceId = insertSource(project.id, url, 'youtube', 'REPASTE0001');

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(basename(result.outputPath), 'người dùng vẫn nhận bản CapCut').toContain('.capcut-edit-');
    expect(mastersIn(own)).toHaveLength(1);
    expect(sources.get(sourceId)?.sourceFile).toBe(join(own, mastersIn(own)[0]!));
  });

  it('đúng ca người dùng: bản CapCut đã bị xoá/chuyển đi, video gốc còn → dán lại link KHÔNG tải lại, tạo lại bản CapCut từ gốc', async () => {
    const { own, url, project } = capcutSetup('TA902', 'REPASTE0002');
    const sourceId = insertSource(project.id, url, 'youtube', 'REPASTE0002');
    await run(jobFor(project.id, sourceId, 'download-only'));
    for (const name of editsIn(own)) rmSync(join(own, name));
    const downloadsBefore = ytdlpOutputTemplates.length;

    const again = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(ytdlpOutputTemplates.length - downloadsBefore, 'không được gọi yt-dlp tải lại').toBe(0);
    expect(again.skipped).toBe(true);
    expect(mastersIn(own), 'vẫn chỉ một video gốc').toHaveLength(1);
    expect(editsIn(own)).toHaveLength(1);
  });

  it('bản ghi CŨ (trước bản sửa) trỏ tới bản CapCut đã mất, video gốc còn → tìm lại gốc, không tải lại', async () => {
    const { own, url, project } = capcutSetup('TA903', 'REPASTE0003');
    const tag = downloadLinkTag(url);
    const master = join(own, `Video cũ [REPASTE0003] [${tag}].mp4`);
    writeVideo(master);
    const policy = downloadPolicyForWorkflow(settingsForDownloadWorkflow(settings, 'download-only'), 'download-only', 'youtube');
    const goneEdit = join(own, `Video cũ [REPASTE0003] [${tag}].capcut-edit-1790000000000.mp4`);
    const sourceId = insertSource(project.id, url, 'youtube', 'REPASTE0003', { path: goneEdit, policy });

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(ytdlpOutputTemplates, 'không được gọi yt-dlp tải lại').toEqual([]);
    expect(result.skipped).toBe(true);
    expect(sources.get(sourceId)?.sourceFile).toBe(master);
    expect(eventCodes()).toEqual(expect.arrayContaining(['SOURCE_CACHE_MISSING', 'EXISTING_DOWNLOAD_DISCOVERED', 'SOURCE_CACHE_HIT']));
  });

  it('link dán dạng khác (mã liên kết khác) nhưng cùng mã video → vẫn nhận ra video gốc theo mã video', async () => {
    const { own, project } = capcutSetup('TA904', 'REPASTE0004');
    const master = join(own, `Video [REPASTE0004] [${downloadLinkTag('https://www.youtube.com/watch?v=REPASTE0004&list=PL1')}].mp4`);
    writeVideo(master);
    const sourceId = insertSource(project.id, 'https://www.youtube.com/watch?v=REPASTE0004', 'youtube', 'REPASTE0004');

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(ytdlpOutputTemplates).toEqual([]);
    expect(result.skipped).toBe(true);
    expect(sources.get(sourceId)?.sourceFile).toBe(master);
  });

  it('đối chứng: cả video gốc lẫn bản CapCut đều đã bị xoá → tải lại như bình thường', async () => {
    const { own, url, project } = capcutSetup('TA905', 'REPASTE0005');
    const sourceId = insertSource(project.id, url, 'youtube', 'REPASTE0005');
    await run(jobFor(project.id, sourceId, 'download-only'));
    for (const name of mp4s(own)) rmSync(join(own, name));

    const again = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(ytdlpOutputTemplates).toHaveLength(2);
    expect(again.skipped).toBe(false);
  });
});

describe('Phần 2 — đã có bản CapCut cho đúng video gốc thì dùng lại, không mã hoá lại', () => {
  const encodes = (): number => ffmpegCalls.filter((args) => args.some((arg) => arg.includes('.capcut-edit-'))).length;

  it('danh sách khác dán lại link (cùng thư mục) → dùng lại bản CapCut có sẵn, không chạy FFmpeg, không thêm tệp', async () => {
    const { own, url, project } = capcutSetup('TA911', 'REPASTE0011');
    const first = insertSource(project.id, url, 'youtube', 'REPASTE0011');
    const firstResult = await run(jobFor(project.id, first, 'download-only'));
    const encodesAfterFirst = encodes();
    const other = makeProject('Danh sách hôm sau', own);
    const second = insertSource(other.id, url, 'youtube', 'REPASTE0011');

    const result = await run(jobFor(other.id, second, 'download-only'));

    expect(encodes() - encodesAfterFirst, 'không mã hoá lại bản CapCut').toBe(0);
    expect(result).toMatchObject({ skipped: true, outputPath: firstResult.outputPath });
    expect(editsIn(own)).toHaveLength(1);
    expect(ytdlpOutputTemplates).toHaveLength(1);
  });

  it('cùng danh sách dán lại link → dùng lại bản CapCut có sẵn', async () => {
    const { own, url, project } = capcutSetup('TA912', 'REPASTE0012');
    const sourceId = insertSource(project.id, url, 'youtube', 'REPASTE0012');
    const firstResult = await run(jobFor(project.id, sourceId, 'download-only'));
    const encodesAfterFirst = encodes();

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(encodes() - encodesAfterFirst).toBe(0);
    expect(result).toMatchObject({ skipped: true, outputPath: firstResult.outputPath });
    expect(editsIn(own)).toHaveLength(1);
  });

  it('đối chứng: bản CapCut có sẵn bị hỏng → bỏ qua nó, tạo bản mới từ video gốc (không tải lại)', async () => {
    const { own, url, project } = capcutSetup('TA913', 'REPASTE0013');
    const sourceId = insertSource(project.id, url, 'youtube', 'REPASTE0013');
    await run(jobFor(project.id, sourceId, 'download-only'));
    const oldEdit = join(own, editsIn(own)[0]!);
    brokenFiles.add(oldEdit);
    const encodesAfterFirst = encodes();
    const other = makeProject('Danh sách khác', own);
    const second = insertSource(other.id, url, 'youtube', 'REPASTE0013');

    const result = await run(jobFor(other.id, second, 'download-only'));

    expect(encodes() - encodesAfterFirst).toBe(1);
    expect(result.outputPath).not.toBe(oldEdit);
    expect(ytdlpOutputTemplates).toHaveLength(1);
  });
});

describe('Phần 3 (1.7.4) — tạo bản CapCut trên ổ HDD không bắt video đã tải xong phải đứng chờ', () => {
  // Người dùng báo 2026-11-03 trên 1.7.3: app "cứ xoay, không tải". Đo thật: 3 video đã tải xong đứng chờ lượt mã hoá CapCut
  // (HDD mỗi lúc 1 bản; bản HDR đang chạy > 14 phút), mỗi video vẫn giữ chỗ tải của danh sách → 0 lượt tải, mạng ≈ 0. Trong lúc
  // chỉ mã hoá, ổ E: (HDD) bận 2–5% — mã hoá CapCut không phải thứ làm ổ nghẽn, nên không được xếp lượt theo ổ.
  it('hai video tải xong trên ổ HDD → hai bản CapCut được tạo cùng lúc, không bản nào phải chờ bản kia', async () => {
    let running = 0;
    let peak = 0;
    let releaseAll: () => void = () => undefined;
    const allStarted = new Promise<void>((resolve) => (releaseAll = resolve));
    encodeHold = async () => {
      running += 1;
      peak = Math.max(peak, running);
      if (running >= 2) releaseAll();
      await Promise.race([allStarted, new Promise((resolve) => setTimeout(resolve, 1_500))]);
      running -= 1;
    };
    // App thật nối bộ tra loại ổ; giả lập ổ lưu là HDD (bản 1.7.3 dùng nó để xếp lượt mã hoá).
    (engine as unknown as { setDiskKindLookup?: (lookup: (letter: string) => 'hdd') => void }).setDiskKindLookup?.(() => 'hdd');
    const a = capcutSetup('HDD1', 'HDDGATE0001');
    const b = capcutSetup('HDD2', 'HDDGATE0002');
    const first = insertSource(a.project.id, a.url, 'youtube', 'HDDGATE0001');
    const second = insertSource(b.project.id, b.url, 'youtube', 'HDDGATE0002');

    await Promise.all([run(jobFor(a.project.id, first, 'download-only')), run(jobFor(b.project.id, second, 'download-only'))]);

    expect(peak, 'hai bản CapCut chạy cùng lúc').toBe(2);
    expect(editsIn(a.own)).toHaveLength(1);
    expect(editsIn(b.own)).toHaveLength(1);
  });
});
