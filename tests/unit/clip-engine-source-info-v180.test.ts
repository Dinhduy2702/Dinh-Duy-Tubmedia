import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClipEngine } from '../../src/main/clips/clip-engine.js';
import type { FileVerifier, VerificationOptions } from '../../src/main/media/file-verifier.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { ProcessManager, ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { MediaInfo, ProjectItem, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

const resource = { ffmpegThreads: 4, filterThreads: 2, processPriority: 'below_normal' } as ResourceProfile;
const job = { id: 'job-18', projectId: 'proj-18' } as QueueJob;

const silentSource: MediaInfo = {
  duration: 12,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.1',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: null,
  videoBitrate: 5_000_000,
  audioBitrate: null,
  sampleRate: null,
  channels: null,
  channelLayout: null,
  formatName: 'mov,mp4',
  fileSize: 1024
};

describe('Lỗi #18: ClipEngine đọc sourceInfo để xác định expectedStreams.audio và kẹp expectedDuration', () => {
  it('không yêu cầu stream audio khi nguồn không có tiếng và kẹp expectedDuration theo sourceInfo.duration', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-18-clip-'));
    folders.push(folder);
    const input = join(folder, 'silent.mp4');
    await writeFile(input, 'silent-video');

    let verifiedDuration: number | undefined;
    let verifiedOptions: VerificationOptions | undefined;

    const processes = {
      run: async (options: ProcessRunOptions) => {
        await writeFile(options.args.at(-1)!, 'clipped');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    const verifier = {
      verify: (path: string, _level: string, expectedDuration?: number, options?: VerificationOptions) => {
        verifiedDuration = expectedDuration;
        verifiedOptions = options;
        return Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 7 });
      }
    } as unknown as FileVerifier;

    const analyzer = {
      analyze: () => Promise.resolve(silentSource)
    } as unknown as MediaAnalyzer;

    const engine = new ClipEngine(
      { get: () => ({ available: true, executablePath: 'ffmpeg', capabilities: ['libx264', 'zscale', 'tonemap'] }) } as unknown as ToolManager,
      processes,
      verifier,
      {} as QuarantineService,
      analyzer
    );

    const item = {
      id: 'item-18',
      position: 1,
      timestampStartSeconds: 5,
      timestampEndSeconds: 30,
      audioMode: 'keep'
    } as ProjectItem;

    await engine.create(job, item, input, folder, resource, new AbortController().signal, () => undefined);

    expect(verifiedOptions?.expectedStreams?.audio).toBe(false);
    expect(verifiedDuration).toBe(7);
  });
});
