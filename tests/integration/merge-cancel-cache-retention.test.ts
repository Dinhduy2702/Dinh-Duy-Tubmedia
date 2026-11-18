import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureTubmediaOwnedDirectory } from '@main/files/file-ownership.js';
import { DOWNLOAD_TEMP_IDLE_MAX_MS } from '@main/files/download-temp-cleanup.js';
import { NormalizeEngine, type NormalizeTarget } from '@main/normalize/normalize-engine.js';
import { builtInQualityProfiles, builtInResourceProfiles } from '@main/settings/defaults.js';
import type { MediaInfo } from '@shared/types/domain.js';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';

type SyncAccess = { syncProjectStatus: (projectId: string) => void };

let harness: QueueHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

function makeFakeMediaInfo(duration = 120, fileSize = 512_000): MediaInfo {
  return {
    duration,
    width: 2560,
    height: 1440,
    fps: 30,
    videoCodec: 'hevc',
    videoProfile: 'Main',
    videoLevel: '150',
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    timeBase: '1/30',
    videoExtradataHash: 'SHA256:aaa',
    audioExtradataHash: 'SHA256:bbb',
    videoStreamDuration: duration,
    audioStreamDuration: duration,
    nominalFps: 30,
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
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    sampleRate: 44_100,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    fileSize
  };
}

const TARGET_1080P: NormalizeTarget = {
  width: 1920,
  height: 1080,
  fps: 30,
  hdr: false,
  videoCodec: 'h264',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  sampleRate: 44_100,
  channels: 2,
  videoBitrate: 8_000_000
};

describe('V14 — Huỷ hoặc ghép lỗi vẫn giữ bản đệm _normalized-cache / _remux-cache để ghép lại nhanh', () => {
  it('chuẩn hóa xong 7 video rồi bấm Huỷ ở video thứ 8 → 7 bản đệm còn nguyên, chạy lại dùng NORMALIZE_CACHE_HIT không mã hóa lại', async () => {
    harness = createQueueHarness();
    mkdirSync(harness.project.sourceFolder, { recursive: true });
    mkdirSync(harness.project.tempFolder, { recursive: true });
    const normalizeCache = join(harness.project.tempFolder, '_normalized-cache');
    const remuxCache = join(harness.project.tempFolder, '_remux-cache');
    mkdirSync(remuxCache, { recursive: true });
    await ensureTubmediaOwnedDirectory(remuxCache, 'normalize-cache');
    const remuxSample = join(remuxCache, 'sample.remux.mp4');
    writeFileSync(remuxSample, 'remux-ok');

    let ffmpegCalls = 0;
    const processes = {
      run: vi.fn((opts: { args: string[] }) => {
        ffmpegCalls += 1;
        const outPath = opts.args.at(-1)!;
        writeFileSync(outPath, `normalized-video-${ffmpegCalls}`);
        return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 10 });
      })
    };
    const tools = {
      get: vi.fn(() => ({
        name: 'ffmpeg',
        available: true,
        executablePath: 'ffmpeg',
        version: 'test',
        source: 'bundled',
        capabilities: ['libx264', 'aac']
      }))
    };
    const normalizedMediaInfo: MediaInfo = {
      ...makeFakeMediaInfo(),
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      timeBase: '1/90000'
    };
    const analyzer = {
      analyze: vi.fn((filePath: string) =>
        Promise.resolve(filePath.includes('_normalized-cache') ? normalizedMediaInfo : makeFakeMediaInfo())
      )
    };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 120 })),
      decodeStreamFailure: vi.fn(() => Promise.resolve(null))
    };
    const quarantine = { move: vi.fn(() => Promise.resolve('')) };
    const normalizer = new NormalizeEngine(
      tools as never,
      processes as never,
      analyzer as never,
      verifier as never,
      quarantine as never,
      harness.logger as never
    );

    const sources: string[] = [];
    for (let i = 1; i <= 8; i += 1) {
      const p = join(harness.project.sourceFolder, `video-${i}.mp4`);
      writeFileSync(p, `source-bytes-${i}`);
      sources.push(p);
    }

    const firstMergeJob = harness.queue.create({
      projectId: harness.project.id,
      type: 'merge',
      input: { productName: 'thanh-pham' }
    });
    harness.queue.update(firstMergeJob.id, { status: 'merging' });

    // Chuẩn hóa xong 7/8 video vào _normalized-cache
    for (let i = 0; i < 7; i += 1) {
      await normalizer.normalizeToTarget(
        firstMergeJob,
        sources[i]!,
        makeFakeMediaInfo(),
        normalizeCache,
        TARGET_1080P,
        builtInResourceProfiles[0]!,
        new AbortController().signal,
        () => undefined,
        builtInQualityProfiles[0],
        undefined,
        true,
        true,
        { sourceIndex: i + 1 }
      );
    }
    expect(ffmpegCalls).toBe(7);

    // Người dùng bấm Huỷ khi đang ở video thứ 8 → tác vụ sang cancelled, hàng đợi gọi syncProjectStatus + quét mở lại app
    harness.queue.update(firstMergeJob.id, {
      status: 'cancelled',
      errorCode: 'PROCESS_CANCELLED',
      errorMessage: 'Tác vụ đã bị hủy.'
    });
    (harness.manager as unknown as SyncAccess).syncProjectStatus(harness.project.id);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await harness.manager.sweepOrphanTemporaryFiles();

    expect(existsSync(normalizeCache)).toBe(true);
    expect(existsSync(remuxSample)).toBe(true);

    // Người dùng bấm Ghép lại → 7 video đầu lấy thẳng từ NORMALIZE_CACHE_HIT, chỉ mã hóa thêm đúng video thứ 8
    harness.manager.prepareProject(harness.project.id);
    const secondMergeJob = harness.queue.create({
      projectId: harness.project.id,
      type: 'merge',
      input: { productName: 'thanh-pham' }
    });
    harness.queue.update(secondMergeJob.id, { status: 'merging' });

    ffmpegCalls = 0;
    harness.logger.info.mockClear();
    for (let i = 0; i < 8; i += 1) {
      await normalizer.normalizeToTarget(
        secondMergeJob,
        sources[i]!,
        makeFakeMediaInfo(),
        normalizeCache,
        TARGET_1080P,
        builtInResourceProfiles[0]!,
        new AbortController().signal,
        () => undefined,
        builtInQualityProfiles[0],
        undefined,
        true,
        true,
        { sourceIndex: i + 1 }
      );
    }
    expect(ffmpegCalls).toBe(1);
    const cacheHits = harness.logger.info.mock.calls.filter((call) => call[1] === 'NORMALIZE_CACHE_HIT');
    expect(cacheHits).toHaveLength(7);

    // Sau khi ghép thành công hoàn tất (completed) → bản đệm được dọn như bình thường; hoặc nếu bị bỏ quên quá 14 ngày cũng tự dọn
    harness.queue.update(secondMergeJob.id, { status: 'completed' });
    (harness.manager as unknown as SyncAccess).syncProjectStatus(harness.project.id);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(existsSync(normalizeCache)).toBe(false);
  });

  it('bản đệm của lượt Huỷ bị bỏ quên quá 14 ngày vẫn được quét định kỳ dọn sạch để không đầy đĩa', async () => {
    harness = createQueueHarness();
    const normalizeCache = join(harness.project.tempFolder, '_normalized-cache');
    mkdirSync(normalizeCache, { recursive: true });
    await ensureTubmediaOwnedDirectory(normalizeCache, 'normalize-cache');
    const cachedFile = join(normalizeCache, 'old.mp4');
    writeFileSync(cachedFile, 'cached');

    const mergeJob = harness.queue.create({
      projectId: harness.project.id,
      type: 'merge',
      input: { productName: 'thanh-pham' }
    });
    harness.queue.update(mergeJob.id, { status: 'merging' });
    harness.queue.update(mergeJob.id, { status: 'cancelled' });

    // Mới huỷ gần đây → giữ
    await harness.manager.sweepOrphanTemporaryFiles();
    expect(existsSync(cachedFile)).toBe(true);

    // Quá 14 ngày không đụng tới → tự dọn
    const staleDate = new Date(Date.now() - DOWNLOAD_TEMP_IDLE_MAX_MS - 120_000);
    utimesSync(cachedFile, staleDate, staleDate);
    utimesSync(join(normalizeCache, '.tubmedia-owned.json'), staleDate, staleDate);
    utimesSync(normalizeCache, staleDate, staleDate);
    await harness.manager.sweepOrphanTemporaryFiles();
    expect(existsSync(normalizeCache)).toBe(false);
  });
});
