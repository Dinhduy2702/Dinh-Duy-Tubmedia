import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { DownloadEngine } from '@main/downloader/download-engine.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { detectPlatform, downloadLinkTag, normalizeUrl } from '@shared/utils/url.js';
import { DownloadFailedError } from '@shared/errors/app-errors.js';
import type { AppSettings, MediaInfo, QueueJob, ResourceProfile } from '@shared/types/domain.js';

const roots: string[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeMediaInfo(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
    duration: 8,
    videoStreamDuration: 8,
    audioStreamDuration: 8,
    width: 3840,
    height: 2160,
    fps: 24,
    videoCodec: 'h264',
    videoProfile: 'High',
    videoLevel: '5.1',
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    timeBase: '1/90000',
    nominalFps: 24,
    variableFrameRate: false,
    sampleAspectRatio: '1:1',
    displayAspectRatio: '16:9',
    rotation: 0,
    streamStartTime: 0,
    timestampCondition: 'normal',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    colorSpace: 'bt709',
    colorRange: 'tv',
    hdr: false,
    hdrType: null,
    masteringDisplayMetadata: false,
    audioCodec: 'aac',
    videoBitrate: 18_000_000,
    audioBitrate: 192_000,
    sampleRate: 48_000,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    fileSize: 20_000_000,
    ...overrides
  };
}

const RESOURCE: ResourceProfile = builtInResourceProfiles[0]!;

async function createV17Harness(settingsPatch: Partial<AppSettings>) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-v17-'));
  roots.push(root);
  const sourceFolder = join(root, 'video');
  const tempFolder = join(root, 'temp');
  const outputFolder = join(root, 'out');
  const quarantineFolder = join(root, 'quarantine');
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(tempFolder, { recursive: true });
  await mkdir(outputFolder, { recursive: true });
  await mkdir(quarantineFolder, { recursive: true });

  const database = new AppDatabase(join(root, 'studio.sqlite'));
  databases.push(database);
  const projects = new ProjectRepository(database.db);
  const sources = new MediaSourceRepository(database.db);
  const project = projects.create({
    name: 'Danh sách tải kiểm V17',
    sourceFolder,
    tempFolder,
    outputFolder,
    finalFileName: 'Out',
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: RESOURCE.id
  });

  let currentSettings: AppSettings = {
    ...defaultAppSettings,
    downloadCompatibilityMode: 'source',
    downloadMinHeight: 720,
    downloadMaxHeight: 1080,
    downloadMinFps: 0,
    downloadMaxFps: 0,
    downloadCodecPreference: 'h264',
    downloadContainerPreference: 'mp4',
    downloadAllowBelowMinimum: true,
    ...settingsPatch
  };

  const infoByFile = new Map<string, MediaInfo>();
  let verifyOk = true;
  let ytDlpSpawnCount = 0;

  const processes = {
    run: vi.fn(
      async (opts: {
        tool: string;
        args: string[];
        onStdoutLine?: (line: string) => void;
      }) => {
        if (opts.tool === 'yt-dlp') {
          ytDlpSpawnCount += 1;
          const url = opts.args.at(-1)!;
          const normalized = normalizeUrl(url) ?? url;
          const detected = detectPlatform(normalized);
          const tag = downloadLinkTag(normalized);
          const idPart = detected.mediaId ?? 'direct01';
          const outFile = join(sourceFolder, `Clip_${ytDlpSpawnCount} [${idPart}] [${tag}].mp4`);
          await writeFile(outFile, Buffer.alloc(65_536, 7));
          opts.onStdoutLine?.(`__VDMSP_TITLE__:Clip_${ytDlpSpawnCount}`);
          opts.onStdoutLine?.(`__VDMSP_ID__:${idPart}`);
          opts.onStdoutLine?.(`__VDMSP_FILE__:${outFile}`);
          opts.onStdoutLine?.(
            `__VDMSP_FORMAT__:source|NA|NA|NA|NA|NA|NA|NA|NA|NA|NA|NA|8.0`
          );
          return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 10 };
        }
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 5 };
      }
    )
  };

  const tools = {
    get: vi.fn((name: string) => ({
      name,
      available: true,
      executablePath: join(root, `${name}.exe`),
      version: '1.0',
      source: 'bundled',
      capabilities: ['libx264', 'aac']
    }))
  };

  const analyzer = {
    analyze: vi.fn((filePath: string) =>
      Promise.resolve(infoByFile.get(filePath) ?? currentMediaInfo)
    )
  };
  let currentMediaInfo: MediaInfo = makeMediaInfo();

  const verifier = {
    verify: vi.fn(() =>
      Promise.resolve(
        verifyOk
          ? { ok: true, reasons: [], duration: 8 }
          : { ok: false, reasons: ['Tệp hỏng giả lập'], duration: 0 }
      )
    ),
    measureAudio: vi.fn(() => Promise.resolve({ maxVolumeDb: -12, meanVolumeDb: -20 }))
  };

  const quarantine = {
    move: vi.fn(async (filePath: string) => {
      const dest = join(quarantineFolder, `${Date.now()}-${basename(filePath)}`);
      await rename(filePath, dest);
      return dest;
    }),
    settleReplacement: vi.fn(() => Promise.resolve([]))
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const settingsService = { get: () => currentSettings };

  const engine = new DownloadEngine(
    processes as never,
    tools as never,
    sources,
    projects,
    settingsService as never,
    analyzer as never,
    verifier as never,
    quarantine as never,
    logger as never
  );

  const registerSourceAndJob = (rawUrl: string): { sourceId: string; job: QueueJob } => {
    const normalized = normalizeUrl(rawUrl) ?? rawUrl;
    const detected = detectPlatform(normalized);
    const sourceId = randomUUID();
    const now = new Date().toISOString();
    database.db
      .prepare(
        `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,'Clip test',NULL,NULL,NULL,'pending',NULL,?,?)`
      )
      .run(
        sourceId,
        `${detected.platform}:${detected.extractorKey}:${detected.mediaId ?? sourceId}`,
        rawUrl,
        normalized,
        detected.platform,
        detected.extractorKey,
        detected.mediaId ?? '',
        now,
        now
      );
    const job: QueueJob = {
      id: randomUUID(),
      projectId: project.id,
      type: 'download',
      status: 'downloading',
      priority: 100,
      sourceId,
      itemId: null,
      attempts: 0,
      maxAttempts: 3,
      progress: 0,
      speed: null,
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
      input: { url: normalized, workflow: 'download-only' }
    };
    return { sourceId, job };
  };

  return {
    sourceFolder,
    quarantineFolder,
    engine,
    quarantine,
    logger,
    processes,
    registerSourceAndJob,
    setMediaInfo: (next: MediaInfo) => {
      currentMediaInfo = next;
    },
    setVerifyOk: (ok: boolean) => {
      verifyOk = ok;
    },
    setSettings: (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
    },
    getYtDlpSpawnCount: () => ytDlpSpawnCount
  };
}

describe('V17 — Nguồn không chọn được định dạng (Google Drive, liên kết trực tiếp) vượt trần độ phân giải / FPS không bị cách ly', () => {
  it('Google Drive 2160p khi danh sách giới hạn tối đa 1080p → giữ nguyên tệp gốc, không cách ly, ghi cảnh báo tiếng Việt rõ ràng; lượt dùng lại cache cũng giữ tệp', async () => {
    const h = await createV17Harness({
      downloadMinHeight: 720,
      downloadMaxHeight: 1080,
      downloadMaxFps: 30
    });
    h.setMediaInfo(makeMediaInfo({ width: 3840, height: 2160, fps: 60 }));

    const { job } = h.registerSourceAndJob(
      'https://drive.google.com/file/d/1BYZDyKf1QrOU4QFAVeqJZEUCG_7g2KIb/view'
    );
    const res1 = await h.engine.run(job, RESOURCE, new AbortController().signal, () => undefined);

    expect(res1.skipped).toBe(false);
    expect(existsSync(res1.outputPath)).toBe(true);
    expect(h.quarantine.move).not.toHaveBeenCalled();

    const warnMessages = h.logger.warn.mock.calls.map((c) => String(c[2] ?? '')).join('\n');
    expect(warnMessages).toContain(
      'Video gốc trên Google Drive là 2160p, cao hơn mức tối đa 1080p của danh sách; Tubmedia giữ nguyên tệp gốc vì Google Drive không cho chọn chất lượng.'
    );
    expect(res1.resultMessage).toContain('Google Drive không cho chọn chất lượng');

    // Lượt chạy thứ 2 trên cùng nguồn (nhánh dùng lại cache): KHÔNG bị SOURCE_CACHE_QUALITY_MISS hay quality_unmet
    h.logger.warn.mockClear();
    const job2: QueueJob = { ...job, id: randomUUID() };
    const res2 = await h.engine.run(job2, RESOURCE, new AbortController().signal, () => undefined);
    expect(res2.skipped).toBe(true);
    expect(res2.outputPath).toBe(res1.outputPath);
    expect(existsSync(res2.outputPath)).toBe(true);
    expect(h.getYtDlpSpawnCount()).toBe(1);
    expect(h.quarantine.move).not.toHaveBeenCalled();
  });

  it('liên kết tệp trực tiếp (extractor generic) 2160p vượt giới hạn 1080p → giữ tệp, không cách ly và ghi cảnh báo', async () => {
    const h = await createV17Harness({
      downloadMinHeight: 720,
      downloadMaxHeight: 1080,
      downloadAllowBelowMinimum: false
    });
    h.setMediaInfo(makeMediaInfo({ width: 3840, height: 2160, fps: 30 }));

    const { job } = h.registerSourceAndJob('https://cdn.example.com/media/sugarcane-4k.mp4');
    const res = await h.engine.run(job, RESOURCE, new AbortController().signal, () => undefined);

    expect(existsSync(res.outputPath)).toBe(true);
    expect(h.quarantine.move).not.toHaveBeenCalled();
    const warnMessages = h.logger.warn.mock.calls.map((c) => String(c[2] ?? '')).join('\n');
    expect(warnMessages).toContain('2160p, cao hơn mức tối đa 1080p của danh sách');
    expect(warnMessages).toContain('không cho chọn chất lượng');
  });

  it('YouTube 2160p vượt giới hạn 1080p → GIỮ NGUYÊN hành vi cũ (chặn quality_unmet và chuyển khu cách ly)', async () => {
    const h = await createV17Harness({
      downloadMinHeight: 720,
      downloadMaxHeight: 1080
    });
    h.setMediaInfo(makeMediaInfo({ width: 3840, height: 2160, fps: 30 }));

    const { job } = h.registerSourceAndJob('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(
      h.engine.run(job, RESOURCE, new AbortController().signal, () => undefined)
    ).rejects.toThrow(/Chiều cao 2160px vượt mức tối đa 1080px/);
    expect(h.quarantine.move).toHaveBeenCalledTimes(1);
  });

  it('Google Drive dưới mức tối thiểu (khi không cho phép fallback) hoặc tệp hỏng → GIỮ NGUYÊN hành vi cũ (bị chặn và cách ly)', async () => {
    const h = await createV17Harness({
      downloadMinHeight: 1080,
      downloadMaxHeight: 1080,
      downloadAllowBelowMinimum: false
    });
    h.setMediaInfo(makeMediaInfo({ width: 854, height: 480, fps: 30 }));

    const { job: lowResJob } = h.registerSourceAndJob(
      'https://drive.google.com/file/d/1LowResFileId12345/view'
    );
    await expect(
      h.engine.run(lowResJob, RESOURCE, new AbortController().signal, () => undefined)
    ).rejects.toBeInstanceOf(DownloadFailedError);
    expect(h.quarantine.move).toHaveBeenCalledTimes(1);

    // Tệp hỏng giải mã trên Google Drive vẫn bị chặn như cũ
    h.setMediaInfo(makeMediaInfo({ width: 3840, height: 2160, fps: 24 }));
    h.setVerifyOk(false);
    const { job: corruptJob } = h.registerSourceAndJob(
      'https://drive.google.com/file/d/1CorruptFileId67890/view'
    );
    await expect(
      h.engine.run(corruptJob, RESOURCE, new AbortController().signal, () => undefined)
    ).rejects.toBeInstanceOf(DownloadFailedError);
    expect(h.quarantine.move).toHaveBeenCalledTimes(2);
  });
});
