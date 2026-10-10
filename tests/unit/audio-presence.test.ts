import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SILENT_MAX_VOLUME_DB,
  audioIssueFor,
  audioIssueLabel,
  audioIssueNote,
  formatPromisesAudio,
  parseVolumeDetect
} from '../../src/shared/utils/audio-presence.js';
import { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';

// P1 (2026-10-10, điều tra "tải nhiều video, một số không có tiếng"): tái hiện thật cho thấy tệp "không có tiếng" là do
// NGUỒN im lặng (YouTube Q7bzbdvwgBU: định dạng 140 đo −91 dB) hoặc nguồn không có luồng tiếng — app không hề cảnh báo.
describe('P1 — phân loại tiếng của tệp đã tải', () => {
  it('đọc đúng mean/max từ stderr của ffmpeg volumedetect', () => {
    const stderr = [
      '[Parsed_volumedetect_0 @ 000001dea07547c0] n_samples: 1056768',
      '[Parsed_volumedetect_0 @ 000001dea07547c0] mean_volume: -91.0 dB',
      '[Parsed_volumedetect_0 @ 000001dea07547c0] max_volume: -91.0 dB'
    ].join('\n');
    expect(parseVolumeDetect(stderr)).toEqual({ meanVolumeDb: -91, maxVolumeDb: -91 });
    expect(parseVolumeDetect('mean_volume: -20.8 dB\nmax_volume: 0.0 dB')).toEqual({ meanVolumeDb: -20.8, maxVolumeDb: 0 });
    expect(parseVolumeDetect('không có gì')).toBeNull();
  });

  it('không có luồng tiếng → missing; đỉnh ≤ ngưỡng im lặng → silent; có tiếng hoặc đo không được → không cảnh báo', () => {
    expect(audioIssueFor({ hasAudioStream: false, maxVolumeDb: null })).toBe('missing');
    expect(audioIssueFor({ hasAudioStream: true, maxVolumeDb: -91 })).toBe('silent');
    expect(audioIssueFor({ hasAudioStream: true, maxVolumeDb: SILENT_MAX_VOLUME_DB })).toBe('silent');
    expect(audioIssueFor({ hasAudioStream: true, maxVolumeDb: -31.4 })).toBeNull();
    expect(audioIssueFor({ hasAudioStream: true, maxVolumeDb: 0 })).toBeNull();
    // Đo thất bại (thiếu ffmpeg, lỗi giải mã) thì KHÔNG báo nhầm là im lặng.
    expect(audioIssueFor({ hasAudioStream: true, maxVolumeDb: null })).toBeNull();
  });

  it('chữ hiển thị tiếng Việt, nói rõ là do nguồn', () => {
    expect(audioIssueLabel('missing')).toBe('Không có tiếng');
    expect(audioIssueLabel('silent')).toBe('Tiếng im lặng');
    expect(audioIssueNote('missing')).toContain('không có luồng âm thanh');
    expect(audioIssueNote('silent')).toContain('im lặng');
    expect(audioIssueNote('silent')).toContain('nguồn');
  });
});

describe('P2 — định dạng yt-dlp đã chọn có hứa luồng tiếng không', () => {
  it('codec tiếng thật (mp4a, opus, aac…) → có; none / NA / rỗng / không rõ → không (không được coi là mất tiếng)', () => {
    for (const codec of ['mp4a.40.2', 'opus', 'aac', 'mp4a.40.5', ' Opus ']) expect(formatPromisesAudio(codec), codec).toBe(true);
    for (const codec of ['none', 'NA', 'na', 'N/A', 'unknown', '', '   ', null, undefined]) expect(formatPromisesAudio(codec), String(codec)).toBe(false);
  });
});

describe('P1 — FileVerifier.measureAudio đo âm lượng thật bằng ffmpeg', () => {
  const setup = async (run: ReturnType<typeof vi.fn>, available = true) => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-measure-audio-'));
    const file = join(root, 'video.mp4');
    await writeFile(file, Buffer.from('fixture'));
    const verifier = new FileVerifier(
      { analyze: vi.fn() } as unknown as MediaAnalyzer,
      { run } as unknown as ProcessManager,
      { get: vi.fn(() => (available ? { available: true, executablePath: 'ffmpeg.exe' } : { available: false, executablePath: null })) } as unknown as ToolManager
    );
    return { root, file, verifier };
  };

  it('chạy ffmpeg volumedetect trên luồng tiếng đầu tiên và trả mức đo được', async () => {
    const run = vi.fn((options: { onStderrLine?: (line: string) => void }) => {
      options.onStderrLine?.('[Parsed_volumedetect_0 @ 0] mean_volume: -91.0 dB');
      options.onStderrLine?.('[Parsed_volumedetect_0 @ 0] max_volume: -91.0 dB');
      return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 });
    });
    const { root, file, verifier } = await setup(run);
    try {
      await expect(verifier.measureAudio(file, { jobId: 'job-1' })).resolves.toEqual({ meanVolumeDb: -91, maxVolumeDb: -91 });
      const args = (run.mock.calls[0]![0] as { args: string[] }).args;
      expect(args).toEqual(expect.arrayContaining(['-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null']));
      expect(args).toContain('-vn');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('thiếu ffmpeg hoặc ffmpeg lỗi → null (không đoán)', async () => {
    const missing = await setup(vi.fn(), false);
    const failing = await setup(vi.fn(() => Promise.resolve({ code: 1, stdoutTail: '', stderrTail: 'Invalid data', durationMs: 1 })));
    try {
      await expect(missing.verifier.measureAudio(missing.file)).resolves.toBeNull();
      await expect(failing.verifier.measureAudio(failing.file)).resolves.toBeNull();
    } finally {
      await rm(missing.root, { recursive: true, force: true });
      await rm(failing.root, { recursive: true, force: true });
    }
  });
});
