import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/contracts/channels.js';
import { ProcessCancelledError, ProcessStalledError } from '@shared/errors/app-errors.js';
import type { AttentionNotice, MediaInfo, ParsedInputLine, QueueJob, ResourceProfile } from '@shared/types/domain.js';
import { AppDatabase } from '@main/database/database.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { FileVerifier } from '@main/media/file-verifier.js';
import { MergeEngine } from '@main/merge/merge-engine.js';
import { TimelineService } from '@main/merge/timeline-service.js';
import { ProcessManager } from '@main/processes/process-manager.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';

const tempRoots: string[] = [];
const openDbs: Array<{ close: () => void }> = [];

function createSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tubmedia-t37-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

const sampleInfo = (duration = 60): MediaInfo => ({
  duration,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.0',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 4_000_000,
  audioBitrate: 192_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  fileSize: 4 * 1024 * 1024
});

const balancedProfile: ResourceProfile = {
  ...builtInResourceProfiles.find((p) => p.id === 'resource-balanced')!,
  diskFreeMinimumBytes: 0,
  builtIn: false
};

describe('T3–T7 — Hoàn thiện luồng "Chỉ tạo Timeline, không ghép video"', () => {
  it('T3 & T6: Giao diện không lưu chết timelineOnly vào localStorage qua phiên mới, xoá khi removeLane, hiện băng cảnh báo sát nút chính và ghi chú mốc cắt ?t= / mute (~0,1–0,5s)', () => {
    const ui = readFileSync('src/renderer/src/pages/DownloadMergePage.tsx', 'utf8');
    expect(ui).not.toContain("window.localStorage.getItem('tubmedia.merge.timelineOnly.'");
    expect(ui).toContain('window.sessionStorage');
    expect(ui).toContain('merge-timeline-only-banner');
    expect(ui.indexOf('merge-timeline-only-banner')).toBeLessThan(ui.indexOf('className="lane-primary-actions"'));
    expect(ui).toMatch(/0,1[–-]0,5\s*giây/);
  });

  it('T4: FileVerifier.verify("deep") không nuốt ProcessCancelledError / ProcessStalledError, bắt tệp cụt lệch thời lượng header và cấp speed / etaSeconds thật cho createTimelineOnly', async () => {
    const sandbox = createSandbox();
    const clipPath = join(sandbox, 'clip.mp4');
    writeFileSync(clipPath, 'video-data');

    const analyzer = {
      analyze: vi.fn(() => Promise.resolve(sampleInfo(60))),
      forget: vi.fn()
    };
    const tools = {
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
    };

    // 1) Không nuốt ProcessCancelledError / ProcessStalledError
    const cancelledVerifier = new FileVerifier(
      analyzer as never,
      { run: vi.fn(() => Promise.reject(new ProcessCancelledError())) } as never,
      tools as never
    );
    await expect(cancelledVerifier.verify(clipPath, 'deep', 60)).rejects.toBeInstanceOf(ProcessCancelledError);

    const stalledVerifier = new FileVerifier(
      analyzer as never,
      { run: vi.fn(() => Promise.reject(new ProcessStalledError('ffmpeg', 'kẹt giải mã'))) } as never,
      tools as never
    );
    await expect(stalledVerifier.verify(clipPath, 'deep', 60)).rejects.toBeInstanceOf(ProcessStalledError);

    // 2) Header báo 60s nhưng giải mã thật chỉ có 12s → đánh không đạt
    const truncatedVerifier = new FileVerifier(
      analyzer as never,
      {
        run: vi.fn((opts: { onStdoutLine?: (line: string) => void }) => {
          opts.onStdoutLine?.('out_time_ms=12000000');
          opts.onStdoutLine?.('progress=end');
          return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 20 });
        })
      } as never,
      tools as never
    );
    const truncatedCheck = await truncatedVerifier.verify(clipPath, 'deep', 60);
    expect(truncatedCheck.ok).toBe(false);
    expect(truncatedCheck.reasons.join(' ')).toContain('Thời lượng giải mã thực tế');

    // 3) createTimelineOnly đẩy speed và etaSeconds thật ra onProgress
    const okVerifier = new FileVerifier(
      analyzer as never,
      {
        run: vi.fn((opts: { onStdoutLine?: (line: string) => void }) => {
          opts.onStdoutLine?.('out_time_ms=30000000');
          opts.onStdoutLine?.('speed=2.5x');
          opts.onStdoutLine?.('progress=continue');
          opts.onStdoutLine?.('out_time_ms=60000000');
          opts.onStdoutLine?.('speed=2.5x');
          opts.onStdoutLine?.('progress=end');
          return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 30 });
        })
      } as never,
      tools as never
    );
    const engine = new MergeEngine(
      tools as never,
      { run: vi.fn() } as never,
      analyzer as never,
      okVerifier,
      {} as never,
      new TimelineService(analyzer as never),
      { move: vi.fn() } as never
    );
    const seenSpeeds: Array<string | null> = [];
    const seenEtas: Array<number | null> = [];
    await engine.createTimelineOnly(
      { id: 'job-t4', projectId: 'proj-t4' } as QueueJob,
      [{ path: clipPath, label: 'Clip 1', note: '', sourceStartSeconds: null, sourceEndSeconds: null }],
      balancedProfile,
      new AbortController().signal,
      (prog) => {
        seenSpeeds.push(prog.speed);
        seenEtas.push(prog.etaSeconds);
      }
    );
    expect(seenSpeeds.some((s) => typeof s === 'string' && s.startsWith('2.5'))).toBe(true);
    expect(seenEtas.some((eta) => typeof eta === 'number' && eta > 0)).toBe(true);
  });

  it('T5: Khi video #1 lỗi sớm trong createTimelineOnly, nhánh song song video #2 bị abort ngay lập tức; ProcessManager.killByJob diệt cả sub-job theo tiền tố', async () => {
    const sandbox = createSandbox();
    const v1 = join(sandbox, 'v1.mp4');
    const v2 = join(sandbox, 'v2.mp4');
    writeFileSync(v1, '1');
    writeFileSync(v2, '2');

    const analyzer = {
      analyze: vi.fn(() => Promise.resolve(sampleInfo(30))),
      forget: vi.fn()
    };
    let v2Aborted = false;
    const verifier = {
      verify: vi.fn((filePath: string, _level: string, _dur?: number, opts?: { signal?: AbortSignal }) => {
        if (filePath === v1) {
          return Promise.resolve({ ok: false, path: v1, level: 'deep' as const, reasons: ['hỏng gói tin'], duration: 0 });
        }
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener(
            'abort',
            () => {
              v2Aborted = true;
              reject(new ProcessCancelledError());
            },
            { once: true }
          );
        });
      })
    };

    const engine = new MergeEngine(
      { get: vi.fn(() => ({ available: true, executablePath: 'ffmpeg.exe' })) } as never,
      { run: vi.fn() } as never,
      analyzer as never,
      verifier as never,
      {} as never,
      new TimelineService(analyzer as never),
      { move: vi.fn() } as never
    );

    await expect(
      engine.createTimelineOnly(
        { id: 'job-t5', projectId: 'proj-t5' } as QueueJob,
        [
          { path: v1, label: 'V1', note: '', sourceStartSeconds: null, sourceEndSeconds: null },
          { path: v2, label: 'V2', note: '', sourceStartSeconds: null, sourceEndSeconds: null }
        ],
        { ...balancedProfile, normalizeWorkers: 2 },
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toThrow(/hỏng gói tin/);
    expect(v2Aborted).toBe(true);

    // Kiểm ProcessManager.killByJob diệt cả sub-job có tiền tố `${jobId}-`
    const pm = new ProcessManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    const killSpy = vi.spyOn(pm, 'kill').mockResolvedValue(undefined);
    const internalActive = (pm as unknown as { active: Map<string, { jobId: string }> }).active;
    internalActive.set('proc-main', { jobId: 'job-99' });
    internalActive.set('proc-sub', { jobId: 'job-99-timeline-source-2' });
    internalActive.set('proc-other', { jobId: 'job-999' });

    await pm.killByJob('job-99');
    expect(killSpy).toHaveBeenCalledWith('proc-main');
    expect(killSpy).toHaveBeenCalledWith('proc-sub');
    expect(killSpy).not.toHaveBeenCalledWith('proc-other');
    internalActive.clear();
  });

  it('T7: Nhánh timelineOnly vẫn chạy kiểm tra mergeAudioIssues và phát cảnh báo khi nguồn không có tiếng', async () => {
    const sandbox = createSandbox();
    const database = new AppDatabase(join(sandbox, 'db.sqlite'));
    openDbs.push(database);
    const queue = new QueueRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const items = new ItemRepository(database.db);
    const sources = new MediaSourceRepository(database.db);

    const srcDir = join(sandbox, 'src');
    const tmpDir = join(sandbox, 'tmp');
    const outDir = join(sandbox, 'out');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const silentClip = join(srcDir, 'silent.mp4');
    writeFileSync(silentClip, 'silent-mp4');

    const project = projects.create({
      name: 'Timeline có video câm',
      sourceFolder: srcDir,
      tempFolder: tmpDir,
      outputFolder: outDir,
      finalFileName: 'tl-silent',
      qualityProfileId: 'quality-720p-fast',
      resourceProfileId: 'resource-balanced'
    });

    const parsedLine: ParsedInputLine = {
      id: randomUUID(),
      lineNumber: 1,
      originalText: 'https://www.youtube.com/watch?v=silentvid01',
      url: 'https://www.youtube.com/watch?v=silentvid01',
      normalizedUrl: 'https://www.youtube.com/watch?v=silentvid01',
      platform: 'youtube',
      extractorKey: 'youtube',
      mediaId: 'silentvid01',
      timestampStartSeconds: null,
      timestampEndSeconds: null,
      note: '',
      audioMode: 'keep',
      validity: 'valid',
      warnings: [],
      errors: []
    };
    const imported = items.import(project.id, [parsedLine], 'replace');
    const sourceId = imported[0]!.sourceId!;
    sources.setFile(sourceId, silentClip, { ...sampleInfo(25), audioCodec: null }, 'valid');

    const dlJob = queue.create({
      projectId: project.id,
      type: 'download',
      sourceId,
      input: { audioIssue: 'missing' }
    });
    queue.update(dlJob.id, { status: 'downloading' });
    queue.update(dlJob.id, { status: 'completed', progress: 100 });

    const analyzer = {
      analyze: vi.fn(() => Promise.resolve({ ...sampleInfo(25), audioCodec: null })),
      forget: vi.fn()
    };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, path: silentClip, level: 'deep' as const, reasons: [], duration: 25 }))
    };
    const engine = new MergeEngine(
      { get: vi.fn(() => ({ available: true, executablePath: 'ffmpeg.exe' })) } as never,
      { run: vi.fn() } as never,
      analyzer as never,
      verifier as never,
      {} as never,
      new TimelineService(analyzer as never),
      { move: vi.fn() } as never
    );

    const notices: AttentionNotice[] = [];
    const manager = new QueueManager(
      queue,
      projects,
      items,
      sources,
      {
        get: () => defaultAppSettings,
        profiles: () => ({ resources: builtInResourceProfiles, qualities: builtInQualityProfiles })
      } as never,
      {} as never,
      {} as never,
      engine,
      { killByJob: vi.fn(() => Promise.resolve(undefined)) } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
    );
    manager.setWindow({
      isDestroyed: () => false,
      webContents: {
        send: vi.fn((ch: string, payload: unknown) => {
          if (ch === IPC.events.attention) notices.push(payload as AttentionNotice);
        })
      }
    } as never);

    const mergeJob = queue.create({
      projectId: project.id,
      type: 'merge',
      input: { timelineOnly: true }
    });
    await (
      manager as unknown as {
        execute: (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => Promise<void>;
      }
    ).execute(mergeJob, balancedProfile, new AbortController().signal);

    const finished = queue.get(mergeJob.id)!;
    expect(finished.status).toBe('completed');
    expect(Array.isArray(finished.input.mergeAudioIssues) ? finished.input.mergeAudioIssues.length : 0).toBe(1);
    expect(notices.some((n) => n.code === 'MERGE_SOURCE_AUDIO_ISSUES')).toBe(true);
  });
});
