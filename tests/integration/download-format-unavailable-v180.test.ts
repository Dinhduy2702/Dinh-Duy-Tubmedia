import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QuarantineRepository } from '@main/database/repositories/quarantine-repository.js';
import { QuarantineService } from '@main/media/quarantine-service.js';
import { DownloadEngine } from '@main/downloader/download-engine.js';
import { FORMAT_PROBE_PRINT_TEMPLATE } from '@shared/utils/format-availability.js';
import { builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { friendlyIssue } from '@shared/utils/ui-error.js';
import type { AppSettings, QueueJob } from '@shared/types/domain.js';

// 1.8.0 việc C: chạy DownloadEngine.run() THẬT, chỉ giả lập tiến trình yt-dlp: lượt tải báo "Requested format is not
// available", lượt đọc định dạng (--print mẫu gọn) trả danh sách mà "máy này" nhận được.
const UNAVAILABLE = 'ERROR: [youtube] abcDEF12345: Requested format is not available. Use --list-formats for a list of available formats';

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let sources: MediaSourceRepository;
let engine: DownloadEngine;
let settings: AppSettings;
let probeStdout = '';
let probeStderr = '';
let probeCode = 0;
let calls: string[][] = [];
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-format-unavailable-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  sources = new MediaSourceRepository(database.db);
  settings = { ...defaultAppSettings, downloadCompatibilityMode: 'capcut_sdr_1080p', downloadAllowBelowMinimum: false };
  calls = [];
  probeStdout = '';
  probeStderr = '';
  probeCode = 0;
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const quarantine = new QuarantineService(logger as never, { items: new QuarantineRepository(database.db), projects, rootOf: () => folder });
  const run = vi.fn((options: { args: string[]; onStdoutLine?: (line: string) => void }) => {
    calls.push(options.args);
    if (options.args.includes(FORMAT_PROBE_PRINT_TEMPLATE)) {
      for (const line of probeStdout.split('\n')) if (line) options.onStdoutLine?.(line);
      return Promise.resolve({ code: probeCode, stdoutTail: probeStdout, stderrTail: probeStderr });
    }
    return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: UNAVAILABLE });
  });
  engine = new DownloadEngine(
    { run } as never,
    { get: (name: string) => ({ available: true, executablePath: join(folder, `${name}.exe`), version: '2026.10.26', capabilities: [] }) } as never,
    sources,
    projects,
    { get: () => settings } as never,
    { analyze: vi.fn() } as never,
    { verify: vi.fn(), measureAudio: vi.fn() } as never,
    quarantine,
    logger as never
  );
});
afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

function setupJob(): QueueJob {
  const sourceFolder = join(folder, 'video');
  mkdirSync(sourceFolder, { recursive: true });
  const project = projects.create({
    name: 'ds',
    sourceFolder,
    tempFolder: join(folder, 'tam'),
    outputFolder: join(folder, 'tp'),
    finalFileName: 'ds',
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
  const sourceId = randomUUID();
  const now = new Date().toISOString();
  const url = 'https://www.youtube.com/watch?v=abcDEF12345';
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'unknown',NULL,?,?)`
    )
    .run(sourceId, `youtube:${sourceId}`, url, url, 'youtube', 'youtube', 'abcDEF12345', now, now);
  return {
    id: randomUUID(), projectId: project.id, type: 'download', status: 'downloading', priority: 0, sourceId, itemId: null,
    input: {}, progress: 0, speed: null, etaSeconds: null, attempts: 0, maxAttempts: 3, errorCode: null, errorMessage: null,
    createdAt: now, updatedAt: now, startedAt: now, finishedAt: null
  };
}

const run = (job: QueueJob): Promise<unknown> =>
  engine.run(job, builtInResourceProfiles[0]!, new AbortController().signal, () => undefined);

describe('1.8.0 việc C: lỗi "không có định dạng" trong lượt tải thật', () => {
  it('máy chỉ nhận 360p (không có bộ chạy JS) → báo máy bị hạn chế, gợi ý bật ô để lấy 360p, lưu chi tiết vào nhật ký', async () => {
    probeStdout = `${JSON.stringify([
      { format_id: 'sb0', vcodec: 'none', acodec: 'none', height: 180, fps: 1 },
      { format_id: '18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, fps: 30 }
    ])}\n`;
    probeStderr = 'WARNING: [youtube] No supported JavaScript runtime could be found. Some formats may be missing.';
    const job = setupJob();
    const error = (await run(job).catch((caught: unknown) => caught)) as { code: string; message: string; details: Record<string, unknown> };
    expect(error.code).toBe('DOWNLOAD_FAILED');
    const issue = friendlyIssue(error.message);
    expect(issue.title).toBe('Máy này chỉ nhận được bản 360p');
    expect(issue.steps.join(' ')).toContain('để lấy bản 360p');
    expect(error.details).toMatchObject({
      failureSubtype: 'format_unavailable',
      formatDiagnosis: 'machine_limited',
      availableMaxHeight: 360,
      availableMaxFps: 30,
      ytdlpVersion: '2026.10.26',
      jsRuntime: false
    });
    // Đúng MỘT lượt đọc định dạng, URL vẫn đứng sau "--".
    const probes = calls.filter((args) => args.includes(FORMAT_PROBE_PRINT_TEMPLATE));
    expect(probes).toHaveLength(1);
    expect(probes[0]!.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=abcDEF12345']);
    const logged = (logger.error.mock.calls as Array<[string, string, string, { metadata: Record<string, unknown> }]>).find(
      (call) => call[1] === 'YTDLP_DOWNLOAD_FAILED'
    );
    expect(logged?.[3].metadata).toMatchObject({ formatDiagnosis: 'machine_limited', availableMaxHeight: 360 });
  });

  it('đọc định dạng thất bại → vẫn báo lỗi rõ ràng kèm phiên bản yt-dlp (không treo, không ném lỗi lạ)', async () => {
    probeCode = 1;
    probeStderr = 'ERROR: unable to download webpage: timed out';
    const error = (await run(setupJob()).catch((caught: unknown) => caught)) as { message: string; details: Record<string, unknown> };
    expect(error.details).toMatchObject({ formatDiagnosis: 'probe_failed', formatProbeExitCode: 1 });
    expect(friendlyIssue(error.message).message).toContain('yt-dlp 2026.10.26');
  });
});
