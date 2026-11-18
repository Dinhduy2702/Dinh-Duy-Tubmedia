import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeBackgroundEncodeCpuCapPercent } from '../../src/shared/utils/capcut-encode.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import { downloadPolicyForWorkflow } from '../../src/shared/utils/download-quality.js';
import { DownloadEngine } from '../../src/main/downloader/download-engine.js';
import { ProcessManager, type ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import { WindowsJobHost } from '../../src/main/processes/windows-job-host.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { MediaInfo, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
});

describe('Việc A — Giới hạn CPU động có sàn cho bản mã hoá CapCut nền (1.7.7)', () => {
  it('tính trần CPU động theo số luồng máy: >= 4 luồng giữ tổng < 60% có sàn thời gian <= 2x, máy 2 luồng giữ vùng 65-70%', () => {
    // Máy 4 luồng: mục tiêu tổng ~56% (< 60%), sàn 43% (đảm bảo thời gian mã hoá thật ~1.88x <= 2x), trần 48%
    const cap4Normal = computeBackgroundEncodeCpuCapPercent(4, 12);
    expect(cap4Normal).toBe(44);
    expect(12 + cap4Normal).toBeLessThan(60);
    expect(computeBackgroundEncodeCpuCapPercent(4, 30)).toBe(43);
    expect(computeBackgroundEncodeCpuCapPercent(4, 4)).toBe(48);

    // Máy 2 luồng (Q1b đã duyệt): tải khác ~21% -> cấp 47% (tổng ~68% nằm trong 65-70%, thời gian ~1.8x <= 2x), sàn 45%
    const cap2Normal = computeBackgroundEncodeCpuCapPercent(2, 21);
    expect(cap2Normal).toBe(47);
    expect(21 + cap2Normal).toBeGreaterThanOrEqual(65);
    expect(21 + cap2Normal).toBeLessThanOrEqual(70);
    expect(computeBackgroundEncodeCpuCapPercent(2, 45)).toBe(45);
    expect(computeBackgroundEncodeCpuCapPercent(2, 8)).toBe(50);

    // Máy >= 8 luồng: giữ tổng ~55% (< 60%), sàn 25%, trần 50%
    expect(computeBackgroundEncodeCpuCapPercent(8, 15)).toBe(40);
    expect(computeBackgroundEncodeCpuCapPercent(8, 50)).toBe(25);
    expect(computeBackgroundEncodeCpuCapPercent(8, 0)).toBe(50);
  });

  it('DownloadEngine.makeCapCutCompatible truyền cpuCapGroup = "background-encode" vào ProcessManager.run', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-encode-cap-group-'));
    folders.push(folder);
    const masterPath = join(folder, 'Video goc [ABC123DEF45] [LINK_112233445566].webm');
    await writeFile(masterPath, 'master-vp9', 'utf8');

    const settings = {
      ...defaultAppSettings,
      downloadCompatibilityMode: 'source' as const,
      downloadEditCopyMode: 'capcut_sdr_1080p' as const
    };
    const policy = downloadPolicyForWorkflow(settings, 'download-only');
    const vp9Info: MediaInfo = {
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'vp9',
      videoProfile: '0',
      videoLevel: null,
      pixelFormat: 'yuv420p',
      bitDepth: 8,
      timeBase: '1/1000',
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
      colorSpace: 'bt709',
      hdr: false,
      audioCodec: 'opus',
      videoBitrate: 4_000_000,
      audioBitrate: 128_000,
      sampleRate: 48_000,
      channels: 2,
      channelLayout: 'stereo',
      formatName: 'matroska,webm',
      fileSize: 5000
    };
    const h264Info: MediaInfo = {
      ...vp9Info,
      videoCodec: 'h264',
      audioCodec: 'aac',
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2'
    };

    const capturedOptions: ProcessRunOptions[] = [];
    let editWritten = false;
    const processes = {
      run: async (options: ProcessRunOptions) => {
        capturedOptions.push(options);
        await writeFile(options.args.at(-1)!, 'capcut-edit-bytes', 'utf8');
        editWritten = true;
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    const downloader = new DownloadEngine(
      processes,
      {
        get: (name: string) => ({
          name,
          available: true,
          executablePath: join(folder, `${name}.exe`),
          capabilities: ['libx264', 'aac']
        })
      } as unknown as ToolManager,
      {
        get: () => ({
          id: 'src-1',
          identity: 'youtube:ABC123DEF45',
          originalUrl: 'https://www.youtube.com/watch?v=ABC123DEF45',
          normalizedUrl: 'https://www.youtube.com/watch?v=ABC123DEF45',
          platform: 'youtube',
          extractorKey: 'youtube',
          mediaId: 'ABC123DEF45',
          title: 'Video goc',
          uploader: 'Kenh',
          sourceFile: masterPath,
          downloadPolicy: policy,
          verificationStatus: 'verified',
          mediaInfoJson: null,
          createdAt: '',
          updatedAt: ''
        }),
        othersUsingFile: () => [],
        setFile: vi.fn(),
        setMetadata: vi.fn(),
        promoteIdentity: vi.fn(),
        updateMediaState: vi.fn(),
        clearFileCache: vi.fn(),
        invalidate: vi.fn()
      } as never,
      {
        get: () => ({
          id: 'proj-1',
          name: 'DS',
          sourceFolder: folder,
          tempFolder: join(folder, 'temp'),
          outputFolder: folder,
          finalFileName: 'out',
          workflowMode: 'download_only',
          qualityProfileId: 'q',
          resourceProfileId: 'r'
        })
      } as never,
      { get: () => settings } as never,
      {
        analyze: (path: string) => Promise.resolve(path.endsWith('.webm') ? vp9Info : h264Info)
      } as unknown as MediaAnalyzer,
      {
        verify: (path: string) =>
          Promise.resolve({
            ok: path === masterPath || editWritten,
            path,
            level: 'fast' as const,
            reasons: [],
            duration: 10
          }),
        measureAudio: () => Promise.resolve({ maxVolumeDb: -3, meanVolumeDb: -16 })
      } as unknown as FileVerifier,
      { move: (p: string) => Promise.resolve(p) } as unknown as QuarantineService,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
    );

    const job: QueueJob = {
      id: 'job-capcut-cap',
      projectId: 'proj-1',
      type: 'download',
      status: 'downloading',
      priority: 0,
      sourceId: 'src-1',
      itemId: null,
      input: {},
      progress: 0,
      speed: null,
      etaSeconds: null,
      attempts: 0,
      maxAttempts: 3,
      errorCode: null,
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
      startedAt: '',
      finishedAt: null
    };
    const resource: ResourceProfile = {
      id: 'r',
      name: 'R',
      description: '',
      downloadWorkers: 1,
      analyzeWorkers: 1,
      normalizeWorkers: 1,
      remuxWorkers: 1,
      clipWorkers: 1,
      ffmpegThreads: 2,
      filterThreads: 1,
      filterComplexThreads: 1,
      processPriority: 'below_normal',
      cpuSoftLimitPercent: 85,
      memoryFreeMinimumBytes: 1,
      diskFreeMinimumBytes: 1,
      gpuJobs: 0,
      builtIn: true
    };

    await downloader.run(job, resource, new AbortController().signal, () => undefined);

    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]!.cpuCapGroup).toBe('background-encode');
  });

  it.runIf(process.platform === 'win32')(
    'WindowsJobHost thực thi trần cứng JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP ở tầng kernel cho nhóm background-encode',
    async () => {
      const folder = await mkdtemp(join(tmpdir(), 'tubmedia-kernel-cap-'));
      folders.push(folder);
      const spinScript = join(folder, 'spin.mjs');
      await writeFile(
        spinScript,
        `
const startCpu = process.cpuUsage();
const endAt = Date.now() + 1200;
while (Date.now() < endAt) {}
const used = process.cpuUsage(startCpu);
const cpuMs = (used.user + used.system) / 1000;
process.stdout.write('CPU_MS=' + cpuMs.toFixed(1) + '\\n');
`,
        'utf8'
      );

      const host = new WindowsJobHost(true);
      const pm = new ProcessManager(
        { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger,
        undefined,
        host
      );
      try {
        // 10% của 4 luồng logic = 0.40 nhân vật lý -> trong 1200ms wall-clock chỉ được phép tiêu thụ ~480ms CPU (< 780ms)
        pm.setBackgroundEncodeCpuCap(10, 4);
        let cpuMs = 9999;
        await pm.run({
          jobId: 'cap-spin',
          tool: 'ffmpeg',
          executablePath: process.execPath,
          args: [spinScript],
          cpuCapGroup: 'background-encode',
          onStdoutLine: (line) => {
            if (line.startsWith('CPU_MS=')) {
              cpuMs = Number(line.slice('CPU_MS='.length));
            }
          }
        });
        expect(cpuMs).toBeGreaterThan(150);
        expect(cpuMs).toBeLessThan(780);
      } finally {
        await pm.shutdown();
      }
    },
    20_000
  );
});
