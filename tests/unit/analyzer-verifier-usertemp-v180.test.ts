import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileVerifier } from '../../src/main/media/file-verifier.js';
import { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import {
  categoryTargets,
  listCategoryFiles,
  scanTarget,
  USER_TEMP_MIN_AGE_MS
} from '../../src/main/system/cleanup-scanner.js';
import type { ProcessRunOptions } from '../../src/main/processes/process-manager.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

describe('Lỗi #45: MediaAnalyzer.forget(), FileVerifier deep kiểm luồng tiếng và tuổi tối thiểu userTemp', () => {
  it('MediaAnalyzer.forget(path) xóa cả cacheByFingerprint để lần analyze kế tiếp probe lại', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-45-forget-'));
    folders.push(root);
    const file = join(root, 'sample.mp4');
    await writeFile(file, 'video-bytes');

    const probeRun = vi.fn(() =>
      Promise.resolve({
        code: 0,
        stdoutTail: JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 1920,
              height: 1080,
              avg_frame_rate: '30/1',
              r_frame_rate: '30/1',
              pix_fmt: 'yuv420p',
              duration: '10',
              time_base: '1/90000'
            }
          ],
          format: { duration: '10', bit_rate: '4000000' }
        }),
        stderrTail: '',
        durationMs: 1
      })
    );
    const analyzer = new MediaAnalyzer(
      { run: probeRun } as never,
      { get: () => ({ available: true, executablePath: 'ffprobe.exe' }) } as never
    );

    await analyzer.analyze(file);
    expect(probeRun).toHaveBeenCalledTimes(1);

    // Chưa forget → hit cache
    await analyzer.analyze(file);
    expect(probeRun).toHaveBeenCalledTimes(1);

    // Sau forget → xóa cả cacheByPath lẫn cacheByFingerprint → phải probe lại
    analyzer.forget(file);
    await analyzer.analyze(file);
    expect(probeRun).toHaveBeenCalledTimes(2);
  });

  it('FileVerifier mức deep tự ánh xạ và giải mã luồng tiếng khi nguồn có audio dù caller không truyền expectedStreams.audio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-45-deep-audio-'));
    folders.push(root);
    const file = join(root, 'with-audio.mp4');
    await writeFile(file, 'video');

    const capturedArgs: string[][] = [];
    const analyzer = {
      analyze: vi.fn(() =>
        Promise.resolve({
          duration: 10,
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
          audioCodec: 'aac',
          videoBitrate: 4_000_000,
          audioBitrate: 128_000,
          sampleRate: 48_000,
          channels: 2,
          channelLayout: 'stereo',
          formatName: 'mp4',
          fileSize: 1024
        })
      )
    };
    const processes = {
      run: vi.fn((opts: ProcessRunOptions) => {
        capturedArgs.push(opts.args);
        return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 });
      })
    };
    const tools = {
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
    };
    const verifier = new FileVerifier(analyzer as never, processes as never, tools as never);

    const result = await verifier.verify(file, 'deep', 10);
    expect(result.ok).toBe(true);
    const args = capturedArgs[0] ?? [];
    expect(args).toContain('0:v:0');
    expect(args.some((arg) => arg === '0:a:0' || arg === '0:a:0?')).toBe(true);
  });

  it('cleanup-scanner: userTemp có tuổi tối thiểu an toàn và bỏ qua tệp mới tạo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-45-usertemp-'));
    folders.push(root);
    const tempDir = join(root, 'Temp');
    const localTemp = join(root, 'Local', 'Temp');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(tempDir, { recursive: true });
    await mkdir(localTemp, { recursive: true });

    const freshFile = join(tempDir, 'fresh.tmp');
    const oldFile = join(tempDir, 'stale.tmp');
    await writeFile(freshFile, Buffer.alloc(1000));
    await writeFile(oldFile, Buffer.alloc(2500));
    const oldDate = new Date(Date.now() - USER_TEMP_MIN_AGE_MS - 60_000);
    await utimes(oldFile, oldDate, oldDate);

    const targets = await categoryTargets('userTemp', {
      tempDir,
      localAppData: join(root, 'Local'),
      roamingAppData: join(root, 'Roaming')
    });
    expect(targets.every((target) => (target.minAgeMs ?? 0) >= USER_TEMP_MIN_AGE_MS)).toBe(true);

    const files = await listCategoryFiles(targets[0]!);
    expect(files.map((f) => f.path)).toEqual([oldFile]);

    const scan = await scanTarget(targets[0]!);
    expect(scan.estimatedBytes).toBe(2500);
    expect(scan.matchedItems).toBe(1);
  });
});
