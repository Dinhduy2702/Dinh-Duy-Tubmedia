import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  corruptMiddleAudioPackets,
  makeClip,
  realMediaStack,
  resolveRealFfmpegDirectory,
  strictDecodeStatus
} from './helpers/real-ffmpeg.js';

/**
 * Vụ khách 2026-10-15 (job 03002b08, "Hậu maxhunter 21 10 26"): hậu kiểm toàn bộ thành phẩm dừng ở 11:05 và app chỉ ghi
 * "Lỗi giải mã hình ảnh … gần 00:11:05". Câu lỗi gốc của ffmpeg (do khách tự chạy lại) là
 * "aac … error in spectral data, ESC overflow" — lỗi ở LUỒNG TIẾNG, không phải hình. Log phải giữ nguyên câu lỗi của
 * ffmpeg và nói rõ luồng nào hỏng, để lần sau không phải nhờ khách chạy lệnh.
 */
const toolsDirectory = resolveRealFfmpegDirectory();
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe.skipIf(!toolsDirectory)('Hậu kiểm toàn bộ: ghi câu lỗi gốc của ffmpeg và luồng bị lỗi (ffmpeg thật)', () => {
  it('luồng tiếng hỏng → vấn đề decode ghi stream=audio, kèm câu lỗi aac của ffmpeg, thông báo nói "âm thanh"', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-visual-detail-'));
    folders.push(folder);
    const file = join(folder, 'thanh-pham.mp4');
    makeClip(toolsDirectory!, file, { width: 640, height: 360, fps: 15, seconds: 8, sampleRate: 48000 });
    corruptMiddleAudioPackets(toolsDirectory!, file);
    expect(strictDecodeStatus(toolsDirectory!, file, '0:v:0'), 'tệp mẫu: hình phải sạch').toBe(0);
    expect(strictDecodeStatus(toolsDirectory!, file, '0:a:0'), 'tệp mẫu: tiếng phải hỏng').not.toBe(0);

    const { verifier } = realMediaStack(toolsDirectory!);
    const result = await verifier.verifyVisualIntegrity(file, 8, [], {
      jobId: 'visual-detail-audio',
      expectedStreams: { video: true, audio: true }
    });

    expect(result.ok).toBe(false);
    const decode = result.issues.find((issue) => issue.type === 'decode');
    expect(decode, JSON.stringify(result.issues)).toBeDefined();
    expect(decode!.stream).toBe('audio');
    expect(decode!.ffmpegError).toMatch(/aac/i);
    expect(decode!.ffmpegError).toMatch(/invalid data|error/i);
    expect(decode!.ffmpegError!.length).toBeLessThanOrEqual(1_500);
    expect(decode!.message).toMatch(/âm thanh/);
    expect(decode!.message).not.toMatch(/hình ảnh/);
    expect(result.reasons.join(' ')).toMatch(/âm thanh/);
  }, 120_000);

  it('tệp sạch → không có vấn đề decode (không báo nhầm)', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-visual-detail-'));
    folders.push(folder);
    const file = join(folder, 'thanh-pham.mp4');
    makeClip(toolsDirectory!, file, { width: 640, height: 360, fps: 15, seconds: 8, sampleRate: 48000 });

    const { verifier } = realMediaStack(toolsDirectory!);
    const result = await verifier.verifyVisualIntegrity(file, 8, [], {
      jobId: 'visual-detail-clean',
      expectedStreams: { video: true, audio: true }
    });

    expect(result.issues.filter((issue) => issue.type === 'decode')).toEqual([]);
  }, 120_000);
});
