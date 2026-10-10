import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// S1 (2026-10-10, lỗi ghép "Duy_12_10_2026" ENOENT). Nhật ký thật: 102/102 lần "tìm thấy tệp có sẵn" đều bị ghi nhận
// với chính sách tải null rồi lập tức bị coi là "bản cũ" → chuyển vào khu cách ly và tải lại. Khi tệp đó đang là nguồn
// của danh sách khác (cùng thư mục nguồn, cùng link), danh sách kia mất tệp giữa chừng. Bài này chạy DownloadEngine.run()
// thật trên CSDL thật và tệp thật trong os.tmpdir(); chỉ giả lập ffprobe (analyzer/verifier) và công cụ tải — yt-dlp
// "không có sẵn", nên nếu engine định tải lại thì bài thấy ngay (ToolNotFoundError) thay vì gọi mạng.

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
  toolsGet = vi.fn((name: string) =>
    name === 'yt-dlp' && ytdlpAvailable
      ? { available: true, executablePath: join(folder, 'yt-dlp-gia.exe') }
      : { available: false, executablePath: null }
  );
  const quarantine = new QuarantineService(logger as never, {
    items: quarantineItems,
    projects,
    rootOf: () => driveRoot
  });
  const analyzer = {
    analyze: vi.fn(() =>
      Promise.resolve(noAudioStream ? { ...mediaInfo(4096), audioCodec: null, audioBitrate: null, sampleRate: null, channels: null, channelLayout: null } : mediaInfo(4096))
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
    run: vi.fn((options: { args: string[]; onStdoutLine?: (line: string) => void }) => {
      const template = options.args[options.args.indexOf('-o') + 1] ?? '';
      ytdlpOutputTemplates.push(template);
      const output = template.replace(/%\((\w+)\)[.\d]*[sB]/g, (_match, field: string) =>
        field === 'ext' ? 'mp4' : field === 'id' ? 'ID_TAI_LAI' : 'Ban tai lai'
      );
      writeVideo(output, 5000);
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

describe('S1 — tệp có sẵn tìm thấy trong thư mục nguồn được DÙNG LẠI, không bị coi là bản cũ', () => {
  it('đúng ca thật: danh sách ghép thứ hai cùng thư mục nguồn, cùng link Google Drive → dùng lại, không dời tệp', async () => {
    const shared = join(driveRoot, 'Ghép video', 'video');
    mkdirSync(shared, { recursive: true });
    const url = 'https://drive.google.com/file/d/1KEr-mismJOHVZrNb6ZNuyoDXowcyGh45/view?usp=drive_link';
    const mediaId = '1KEr-mismJOHVZrNb6ZNuyoDXowcyGh45';
    const file = join(shared, `TT82_TBN.mp4 [Nguon-chat-luong-cao] [${mediaId}] [${downloadLinkTag(url)}].mp4`);
    writeVideo(file);
    const policy = downloadPolicyForWorkflow(settingsForDownloadWorkflow(settings, 'download-merge'), 'download-merge', 'google-drive');

    const duy12 = makeProject('Duy_12_10_2026', shared);
    insertSource(duy12.id, url, 'google-drive', mediaId, { path: file, policy });
    const duy17 = makeProject('Duy_17_10_2026', shared);
    const duy17Source = insertSource(duy17.id, url, 'google-drive', mediaId);

    const result = await run(jobFor(duy17.id, duy17Source, 'download-merge'));

    expect(result).toMatchObject({ outputPath: file, skipped: true });
    expect(existsSync(file)).toBe(true);
    expect(quarantineItems.listActive()).toEqual([]);
    expect(eventCodes()).not.toContain('SOURCE_CACHE_POLICY_UPGRADE');
    expect(eventCodes()).toContain('SOURCE_CACHE_HIT');
    expect(sources.get(duy17Source)).toMatchObject({ sourceFile: file, downloadPolicy: policy, verificationStatus: 'valid' });
    expect(toolsGet).not.toHaveBeenCalledWith('yt-dlp');
  });

  it('Tải danh sách: CSDL mất tham chiếu nhưng tệp cùng link còn trong thư mục → dùng lại, không tải lại', async () => {
    const own = join(driveRoot, 'Tai', 'video');
    mkdirSync(own, { recursive: true });
    const url = 'https://www.youtube.com/watch?v=abcDEF12345';
    const file = join(own, `Video thử [abcDEF12345] [${downloadLinkTag(url)}].mp4`);
    writeVideo(file);
    const project = makeProject('Danh sách tải', own);
    const sourceId = insertSource(project.id, url, 'youtube', 'abcDEF12345');

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(result).toMatchObject({ outputPath: file, skipped: true });
    expect(existsSync(file)).toBe(true);
    expect(quarantineItems.listActive()).toEqual([]);
    expect(eventCodes()).not.toContain('SOURCE_CACHE_POLICY_UPGRADE');
    expect(sources.get(sourceId)?.downloadPolicy).toBe(downloadPolicyForWorkflow(settings, 'download-only', 'youtube'));
  });

  it('bản ghi CÓ chính sách cũ thật (không phải tệp vừa tìm thấy) vẫn đi đường nâng cấp như trước', async () => {
    const own = join(driveRoot, 'Cu', 'video');
    mkdirSync(own, { recursive: true });
    const url = 'https://www.youtube.com/watch?v=oldPOLICY01';
    const file = join(own, `Video cũ [oldPOLICY01] [${downloadLinkTag(url)}].mp4`);
    writeVideo(file);
    const project = makeProject('Danh sách cũ', own);
    const sourceId = insertSource(project.id, url, 'youtube', 'oldPOLICY01', { path: file, policy: 'download-list-multiplatform-v1:{}' });

    await expect(run(jobFor(project.id, sourceId, 'download-only'))).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
    expect(eventCodes()).toContain('SOURCE_CACHE_POLICY_UPGRADE');
  });
});

// S2 (2026-10-10): KHÔNG BAO GIỜ dời hay xóa một tệp mà bản ghi nguồn của danh sách khác đang trỏ tới (ghép đọc tệp nguồn
// qua chính bản ghi đó). Nếu danh sách này buộc phải tải lại thì tải ra TỆP MỚI tên khác, để tệp đang được dùng nguyên chỗ.
describe('S2 — không dời tệp danh sách khác đang dùng; buộc tải lại thì tải ra tệp mới', () => {
  const sharedSetup = () => {
    const shared = join(driveRoot, 'Ghép video', 'video');
    mkdirSync(shared, { recursive: true });
    const url = 'https://drive.google.com/file/d/1nbW3fJZdRQOu6nKfE_-dspF6lWDrktEv/view';
    const mediaId = '1nbW3fJZdRQOu6nKfE_-dspF6lWDrktEv';
    const file = join(shared, `TA718_TBN.mp4 [Nguon-chat-luong-cao] [${mediaId}] [${downloadLinkTag(url)}].mp4`);
    writeVideo(file, 4096);
    const policy = downloadPolicyForWorkflow(settingsForDownloadWorkflow(settings, 'download-merge'), 'download-merge', 'google-drive');
    const owner = makeProject('Duy_12_10_2026', shared);
    const ownerSource = insertSource(owner.id, url, 'google-drive', mediaId, { path: file, policy });
    const other = makeProject('Duy_17_10_2026', shared);
    return { shared, url, mediaId, file, policy, owner, ownerSource, other };
  };

  it('bản ghi của danh sách này mang chính sách cũ nhưng tệp đang là nguồn của danh sách khác → giữ nguyên tệp, tải ra tệp mới', async () => {
    const { url, mediaId, file, policy, ownerSource, other } = sharedSetup();
    const otherSource = insertSource(other.id, url, 'google-drive', mediaId, { path: file, policy: 'merge-best-source-multiplatform-v6' });
    ytdlpAvailable = true;

    const result = await run(jobFor(other.id, otherSource, 'download-merge'));

    expect(existsSync(file), 'tệp danh sách kia đang dùng phải còn nguyên chỗ').toBe(true);
    expect(readFileSync(file).length).toBe(4096);
    expect(quarantineItems.listActive()).toEqual([]);
    expect(sources.get(ownerSource)?.sourceFile).toBe(file);
    expect(result.outputPath).not.toBe(file);
    expect(existsSync(result.outputPath)).toBe(true);
    expect(sources.get(otherSource)).toMatchObject({ sourceFile: result.outputPath, downloadPolicy: policy });
    expect(ytdlpOutputTemplates).toHaveLength(1);
    expect(eventCodes()).toContain('SOURCE_FILE_SHARED_KEPT');
  });

  it('tệp dùng chung không qua được kiểm tra của danh sách này → vẫn không bị dời vào khu cách ly', async () => {
    const { url, mediaId, file, policy, ownerSource, other } = sharedSetup();
    const otherSource = insertSource(other.id, url, 'google-drive', mediaId, { path: file, policy });
    brokenFiles.add(file);
    ytdlpAvailable = true;

    const result = await run(jobFor(other.id, otherSource, 'download-merge'));

    expect(existsSync(file)).toBe(true);
    expect(quarantineItems.listActive()).toEqual([]);
    expect(sources.get(ownerSource)?.sourceFile).toBe(file);
    expect(result.outputPath).not.toBe(file);
    expect(sources.get(otherSource)?.sourceFile).toBe(result.outputPath);
  });

  it('đối chứng: tệp chỉ thuộc riêng danh sách này mang chính sách cũ → giữ bản cũ trong khu cách ly như mục 5', async () => {
    const own = join(driveRoot, 'Rieng', 'video');
    mkdirSync(own, { recursive: true });
    const url = 'https://www.youtube.com/watch?v=onlyMINE001';
    const file = join(own, `Video riêng [onlyMINE001] [${downloadLinkTag(url)}].mp4`);
    writeVideo(file);
    const project = makeProject('Danh sách riêng', own);
    const sourceId = insertSource(project.id, url, 'youtube', 'onlyMINE001', { path: file, policy: 'download-list-multiplatform-v1:{}' });
    ytdlpAvailable = true;

    await run(jobFor(project.id, sourceId, 'download-only'));

    expect(quarantineItems.listActive().map((item) => item.originalPath)).toEqual([file]);
    expect(eventCodes()).not.toContain('SOURCE_FILE_SHARED_KEPT');
  });
});

// P1 (2026-10-10): sau khi tải, đo tiếng của tệp. Nguồn không có luồng tiếng hoặc im lặng hoàn toàn (YouTube Q7bzbdvwgBU đo
// −91 dB) phải được báo rõ cho người dùng — trước đây chỉ có một dòng nhật ký "Video không có audio stream" hoặc không gì cả.
describe('P1 — đo tiếng sau khi tải và báo rõ video không có tiếng / im lặng', () => {
  const freshSetup = (name: string, id: string) => {
    const own = join(driveRoot, name, 'video');
    mkdirSync(own, { recursive: true });
    const url = `https://www.youtube.com/watch?v=${id}`;
    const project = makeProject(name, own);
    const sourceId = insertSource(project.id, url, 'youtube', id);
    ytdlpAvailable = true;
    return { own, url, project, sourceId };
  };
  const warnCodes = (): string[] => logger.warn.mock.calls.map((call) => String(call[1]));

  it('tải mới, nguồn im lặng (đỉnh −91 dB) → kết quả ghi rõ "im lặng", nhật ký cảnh báo DOWNLOAD_AUDIO_SILENT', async () => {
    const { project, sourceId } = freshSetup('Im lang', 'Q7bzbdvwgBU');
    measuredMaxVolumeDb = -91;

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(result.skipped).toBe(false);
    expect(result).toMatchObject({ audioIssue: 'silent', audioMaxVolumeDb: -91 });
    expect(result.resultMessage).toContain('im lặng');
    expect(warnCodes()).toContain('DOWNLOAD_AUDIO_SILENT');
    expect(measureAudio.mock.calls.map((call) => call[0] as string)).toEqual([result.outputPath]);
  });

  it('tải mới, nguồn không có luồng tiếng → "missing", DOWNLOAD_AUDIO_MISSING, không cần đo âm lượng', async () => {
    const { project, sourceId } = freshSetup('Khong tieng', 'noAUDIO0001');
    noAudioStream = true;

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(result).toMatchObject({ audioIssue: 'missing' });
    expect(result.resultMessage).toContain('không có luồng âm thanh');
    expect(warnCodes()).toContain('DOWNLOAD_AUDIO_MISSING');
    expect(measureAudio).not.toHaveBeenCalled();
  });

  it('dùng lại tệp đã tải trước đó (bỏ qua tải lại) mà tệp im lặng → vẫn báo "silent"', async () => {
    const own = join(driveRoot, 'Dung lai', 'video');
    mkdirSync(own, { recursive: true });
    const url = 'https://www.youtube.com/watch?v=silentREUSE';
    const file = join(own, `Video im lặng [silentREUSE] [${downloadLinkTag(url)}].mp4`);
    writeVideo(file);
    const project = makeProject('Dung lai', own);
    const sourceId = insertSource(project.id, url, 'youtube', 'silentREUSE');
    measuredMaxVolumeDb = -91;

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(result).toMatchObject({ outputPath: file, skipped: true, audioIssue: 'silent' });
    expect(result.resultMessage).toContain('im lặng');
    expect(warnCodes()).toContain('DOWNLOAD_AUDIO_SILENT');
  });

  it('đối chứng: tiếng bình thường (−3 dB) hoặc đo không được → không cảnh báo gì', async () => {
    const normal = freshSetup('Binh thuong', 'normalAUD01');
    const ok = await run(jobFor(normal.project.id, normal.sourceId, 'download-only'));
    expect(ok.audioIssue).toBeUndefined();

    const unknown = freshSetup('Khong do duoc', 'unknownAUD1');
    measuredMaxVolumeDb = null;
    const notMeasured = await run(jobFor(unknown.project.id, unknown.sourceId, 'download-only'));
    expect(notMeasured.audioIssue).toBeUndefined();
    expect(warnCodes()).not.toContain('DOWNLOAD_AUDIO_SILENT');
    expect(warnCodes()).not.toContain('DOWNLOAD_AUDIO_MISSING');
  });
});

// P2 (2026-10-10): định dạng yt-dlp đã chọn CÓ luồng tiếng (vd. 137+140 → acodec mp4a.40.2) mà tệp nhận được lại không có luồng
// tiếng → mất tiếng thật trong lúc tải/ghép luồng, không phải do nguồn. Phải coi là tải lỗi (thử lại được) và cách ly tệp lỗi
// để lượt tự tải lại không dùng lại nhầm nó (S1 tìm tệp có sẵn theo mã liên kết trong thư mục).
describe('P2 — định dạng có tiếng mà tệp tải về không có luồng tiếng → tải lỗi, tự tải lại', () => {
  const fresh = (name: string, id: string, platform = 'youtube') => {
    const own = join(driveRoot, name, 'video');
    mkdirSync(own, { recursive: true });
    const url = platform === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : `https://drive.google.com/file/d/${id}/view`;
    const project = makeProject(name, own);
    const sourceId = insertSource(project.id, url, platform, id);
    ytdlpAvailable = true;
    noAudioStream = true;
    return { own, project, sourceId };
  };
  const format = (formatId: string, vcodec: string, acodec: string): string =>
    [formatId, '1080', '30', '2500', '', '', vcodec, acodec, '', '', '', '', '522.3'].join('|');

  it('định dạng 137+140 (acodec mp4a.40.2) mà tệp không có tiếng → lỗi DOWNLOAD_FAILED thử lại được, tệp lỗi vào khu cách ly', async () => {
    const { own, project, sourceId } = fresh('Mat tieng', 'lostAUDIO01');
    ytdlpFormatLine = format('137+140', 'avc1.640028', 'mp4a.40.2');

    const failure = await run(jobFor(project.id, sourceId, 'download-only')).then(
      () => null,
      (error: unknown) => error as { code?: string; retryable?: boolean; message?: string }
    );

    expect(failure, 'phải báo lỗi tải, không được coi là tải thành công').not.toBeNull();
    expect(failure).toMatchObject({ code: 'DOWNLOAD_FAILED', retryable: true });
    expect(failure?.message).toContain('mất luồng âm thanh');
    expect(failure?.message).toContain('137+140');
    expect(logger.warn.mock.calls.map((call) => String(call[1]))).toContain('DOWNLOAD_AUDIO_STREAM_LOST');
    const quarantined = quarantineItems.listActive();
    expect(quarantined, 'tệp lỗi phải vào khu cách ly để lượt tải lại không dùng lại nó').toHaveLength(1);
    expect(readdirSync(own).filter((name) => name.endsWith('.mp4')), 'không còn tệp lỗi trong thư mục danh sách').toEqual([]);
    expect(sources.get(sourceId)?.sourceFile ?? null, 'không ghi nhận tệp lỗi làm nguồn').toBeNull();
  });

  it('đối chứng: định dạng chỉ có hình theo nguồn (acodec none) mà không có tiếng → vẫn tải xong, chỉ báo "missing" như P1', async () => {
    const { project, sourceId } = fresh('Nguon khong tieng', 'videoONLY01');
    ytdlpFormatLine = format('3621', 'avc1.4d401f', 'none');

    const result = await run(jobFor(project.id, sourceId, 'download-only'));

    expect(result).toMatchObject({ skipped: false, audioIssue: 'missing' });
    expect(quarantineItems.listActive()).toEqual([]);
  });

  it('đối chứng: Google Drive (acodec NA — nền tảng không công bố) mà không có tiếng → vẫn tải xong, báo "missing"', async () => {
    const { project, sourceId } = fresh('Drive khong tieng', '1DriveNoAudioXYZ', 'google-drive');
    ytdlpFormatLine = format('source', 'NA', 'NA');

    const result = await run(jobFor(project.id, sourceId, 'download-merge'));

    expect(result).toMatchObject({ skipped: false, audioIssue: 'missing' });
    expect(quarantineItems.listActive()).toEqual([]);
  });
});
