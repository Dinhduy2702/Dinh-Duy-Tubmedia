import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

import { ensureTubmediaOwnedDirectory } from '../../src/main/files/file-ownership.js';
import { mergeCachesIdle, removeMergeCaches } from '../../src/main/files/download-temp-cleanup.js';
import { cleanupTemporaryArtifacts, isTubmediaTemporaryFile } from '../../src/main/files/temporary-cleanup.js';
import { NormalizeEngine } from '../../src/main/normalize/normalize-engine.js';
import { scanTubmediaResidue } from '../../src/main/system/cleanup-scanner.js';
import { builtInQualityProfiles, builtInResourceProfiles } from '../../src/main/settings/defaults.js';
import type { MediaInfo, QueueJob } from '../../src/shared/types/domain.js';

const roots: string[] = [];

function fakeInfo(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
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
    videoBitrate: 5_000_000,
    audioBitrate: 128_000,
    sampleRate: 48_000,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mp4',
    fileSize: 1024,
    ...overrides
  };
}

function fakeJob(projectId = 'proj-1'): QueueJob {
  const now = new Date().toISOString();
  return {
    id: 'job-22',
    projectId,
    type: 'normalize',
    status: 'normalizing',
    priority: 1,
    sourceId: 'src-1',
    itemId: 'item-1',
    input: {},
    progress: 0,
    speed: null,
    etaSeconds: null,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('Lỗi #22: kẹp độ dài đường dẫn tạm <= 250 và dọn đủ checkpoint/owned subdir', () => {
  it('NormalizeEngine: kẹp đường dẫn tệp tạm remux & normalize <= 250 ký tự', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-norm-len-'));
    roots.push(root);
    const deepOut = join(root, 'a'.repeat(40), 'b'.repeat(40), '_normalized-cache');
    await mkdir(deepOut, { recursive: true });
    const longSource = join(root, `${'ten-video-rat-dai-'.repeat(10)}.mp4`);
    await writeFile(longSource, 'source');

    const seenPaths: string[] = [];
    const processes = {
      run: vi.fn(async (opts: { args: string[] }) => {
        const out = opts.args.at(-1)!;
        seenPaths.push(out);
        await writeFile(out, 'out');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      })
    };
    const tools = {
      get: vi.fn(() => ({
        name: 'ffmpeg',
        available: true,
        executablePath: 'ffmpeg.exe',
        version: '8.0',
        capabilities: ['libx264', 'aac']
      }))
    };
    const analyzer = {
      analyze: vi.fn(() => Promise.resolve(fakeInfo({ fps: 60 })))
    };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 10 })),
      decodeStreamFailure: vi.fn(() => Promise.resolve(null))
    };
    const quarantine = { move: vi.fn(() => Promise.resolve('')) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const engine = new NormalizeEngine(
      tools as never,
      processes as never,
      analyzer as never,
      verifier as never,
      quarantine as never,
      logger as never
    );

    const remuxed = await engine.remuxForConcat(
      fakeJob(),
      longSource,
      deepOut,
      builtInResourceProfiles[0]!,
      new AbortController().signal,
      () => undefined
    );
    const normalized = await engine.normalizeToTarget(
      fakeJob(),
      longSource,
      fakeInfo({ width: 1280, height: 720, fps: 30 }),
      deepOut,
      {
        width: 1920,
        height: 1080,
        fps: 60,
        hdr: false,
        videoCodec: 'h264',
        pixelFormat: 'yuv420p',
        audioCodec: 'aac',
        sampleRate: 48_000,
        channels: 2
      },
      builtInResourceProfiles[0]!,
      new AbortController().signal,
      () => undefined,
      builtInQualityProfiles[0]
    );

    expect(remuxed.length).toBeLessThanOrEqual(250);
    expect(normalized.length).toBeLessThanOrEqual(250);
    expect(seenPaths.length).toBeGreaterThanOrEqual(2);
    for (const p of seenPaths) {
      expect(p.length).toBeLessThanOrEqual(250);
    }
  });

  it('isTubmediaTemporaryFile nhận diện clip-*.<ext> (webm/mkv) và .tubmedia-checkpoint.json', () => {
    expect(isTubmediaTemporaryFile('clip-1-item-1.webm')).toBe(true);
    expect(isTubmediaTemporaryFile('clip-1-item-1.mkv.pending.mkv')).toBe(true);
    expect(isTubmediaTemporaryFile('clip-1-item-1.mp4.tubmedia-checkpoint.json')).toBe(true);
  });

  it('cleanupTemporaryArtifacts dọn Tubmedia\\merge-checkpoints, clip-*.<ext> + .tubmedia-checkpoint.json và thư mục con có .tubmedia-owned.json', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'tubmedia-clean-22-'));
    roots.push(temp);

    const clipWebm = join(temp, 'clip-1-item-1.webm');
    const clipReceipt = `${clipWebm}.tubmedia-checkpoint.json`;
    await writeFile(clipWebm, 'clip');
    await writeFile(clipReceipt, '{"signature":"abc"}');

    const checkpointDir = join(temp, 'Tubmedia', 'merge-checkpoints');
    await ensureTubmediaOwnedDirectory(checkpointDir, 'merge-checkpoints', join(temp, 'Tubmedia'));
    await writeFile(join(checkpointDir, 'out.1234.pending.mp4'), 'pending');

    const ownedSub = join(temp, 'nested', '_yt_tmp');
    await ensureTubmediaOwnedDirectory(ownedSub, 'download-temp');
    await writeFile(join(ownedSub, 'part.ytdl'), 'x');

    const arbitraryOwned = join(temp, 'custom-owned-sub');
    await mkdir(arbitraryOwned, { recursive: true });
    await writeFile(
      join(arbitraryOwned, '.tubmedia-owned.json'),
      JSON.stringify({ owner: 'Tubmedia', purpose: 'download-temp', createdAt: new Date().toISOString(), version: 1 })
    );
    await writeFile(join(arbitraryOwned, 'old.part'), 'x');

    // Khi preserveTrackedFiles=true: giữ clip và Tubmedia\merge-checkpoints để thử lại
    await cleanupTemporaryArtifacts(temp, [clipWebm], true);
    expect(existsSync(clipWebm)).toBe(true);
    expect(existsSync(checkpointDir)).toBe(true);

    // Khi preserveTrackedFiles=false: dọn sạch toàn bộ
    await cleanupTemporaryArtifacts(temp, [clipWebm], false);
    expect(existsSync(clipWebm)).toBe(false);
    expect(existsSync(clipReceipt)).toBe(false);
    expect(existsSync(checkpointDir)).toBe(false);
    expect(existsSync(ownedSub)).toBe(false);
    expect(existsSync(arbitraryOwned)).toBe(false);
  });

  it('download-temp-cleanup: removeMergeCaches và mergeCachesIdle bao gồm Tubmedia\\merge-checkpoints', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'tubmedia-mc-22-'));
    roots.push(temp);

    const checkpointDir = join(temp, 'Tubmedia', 'merge-checkpoints');
    await ensureTubmediaOwnedDirectory(checkpointDir, 'merge-checkpoints', join(temp, 'Tubmedia'));
    const pending = join(checkpointDir, 'prod.abcd.pending.mp4');
    await writeFile(pending, 'cp');

    expect(await mergeCachesIdle(temp)).toBe(false);
    const removed = await removeMergeCaches(temp, { protectedFolders: [], protectedFiles: [] });
    expect(removed).toBe(1);
    expect(existsSync(checkpointDir)).toBe(false);
  });

  it('cleanup-scanner: quét được clip-*.webm, .tubmedia-checkpoint.json và thư mục con có .tubmedia-owned.json dù thư mục gốc không có marker', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'tubmedia-scan-22-'));
    roots.push(temp);
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    const ownedSub = join(temp, '_yt_tmp');
    await ensureTubmediaOwnedDirectory(ownedSub, 'download-temp');
    const oldClip = join(ownedSub, 'clip-2-abc.webm');
    const oldReceipt = `${oldClip}.tubmedia-checkpoint.json`;
    await writeFile(oldClip, Buffer.alloc(100));
    await writeFile(oldReceipt, Buffer.alloc(50));
    await utimes(oldClip, oldDate, oldDate);
    await utimes(oldReceipt, oldDate, oldDate);

    const checkpointDir = join(temp, 'Tubmedia', 'merge-checkpoints');
    await ensureTubmediaOwnedDirectory(checkpointDir, 'merge-checkpoints', join(temp, 'Tubmedia'));
    const oldPending = join(checkpointDir, 'video.abcd.pending.mp4');
    await writeFile(oldPending, Buffer.alloc(200));
    await utimes(oldPending, oldDate, oldDate);

    // Tệp cùng tên đặt trực tiếp trong thư mục KHÔNG có marker phải vẫn bị bỏ qua
    const unownedFile = join(temp, 'clip-9-unowned.webm');
    await writeFile(unownedFile, Buffer.alloc(999));
    await utimes(unownedFile, oldDate, oldDate);

    const result = await scanTubmediaResidue({
      sourceFolders: [],
      tempFolders: [temp],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.estimatedBytes).toBe(350);
    const paths = result.findings.map((f) => f.path);
    expect(paths).toContain(oldClip);
    expect(paths).toContain(oldReceipt);
    expect(paths).toContain(oldPending);
    expect(paths).not.toContain(unownedFile);
  });
});
