import { describe, expect, it, vi } from 'vitest';
import {
  FORMAT_PROBE_MAX_PER_MINUTE,
  FORMAT_PROBE_WINDOW_MS,
  FormatProbeGuard,
  type FormatProbeResult
} from '../../src/main/downloader/format-probe.js';
import type { FormatUnavailableDiagnosis } from '../../src/shared/utils/format-availability.js';

function fakeProbe(height: number): FormatProbeResult {
  return {
    summary: {
      videoFormats: [{ height, fps: 30, codec: 'H.264', hasAudio: true }],
      maxHeight: height,
      maxFps: 30,
      codecs: ['H.264'],
      hasAudio: true
    },
    text: '',
    exitCode: 0
  };
}

function fakeDiagnosis(reason: string): FormatUnavailableDiagnosis {
  return {
    cause: 'machine_limited',
    reason,
    message: `Chẩn đoán ${reason}`,
    details: { formatDiagnosis: 'machine_limited', formatDiagnosisReason: reason }
  };
}

describe('FormatProbeGuard (1.8.0 việc C — giảm rủi ro dò định dạng)', () => {
  it('dùng lại kết quả trong phiên cho cùng một video, không gọi yt-dlp lần hai', async () => {
    const now = 1_000;
    const guard = new FormatProbeGuard({ now: () => now });
    const runProbe = vi.fn(() => Promise.resolve(fakeProbe(720)));

    const first = await guard.probe({
      videoKey: 'youtube:abc123:0',
      platform: 'youtube',
      projectId: 'p1',
      runProbe
    });
    const second = await guard.probe({
      videoKey: 'youtube:abc123:0',
      platform: 'youtube',
      projectId: 'p1',
      runProbe
    });

    expect(runProbe).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ kind: 'probed', result: fakeProbe(720), cached: false });
    expect(second).toEqual({ kind: 'probed', result: fakeProbe(720), cached: true });
  });

  it('giới hạn tối đa 3 lượt dò/phút/nền tảng; lượt thứ 4 trả chẩn đoán gần nhất cùng danh sách rồi mở lại sau 1 phút', async () => {
    let now = 10_000;
    const guard = new FormatProbeGuard({ now: () => now });
    const runProbe = vi.fn(() => Promise.resolve(fakeProbe(720)));

    for (let i = 1; i <= FORMAT_PROBE_MAX_PER_MINUTE; i += 1) {
      const outcome = await guard.probe({
        videoKey: `youtube:v${i}:0`,
        platform: 'youtube',
        projectId: 'proj-1',
        runProbe
      });
      expect(outcome.kind).toBe('probed');
      guard.rememberProjectDiagnosis('proj-1', fakeDiagnosis(`d-${i}`));
    }
    expect(runProbe).toHaveBeenCalledTimes(FORMAT_PROBE_MAX_PER_MINUTE);

    // Lượt thứ 4 trong cùng phút trên YouTube bị chặn → dùng chẩn đoán gần nhất cùng danh sách.
    const limitedSameProject = await guard.probe({
      videoKey: 'youtube:v4:0',
      platform: 'youtube',
      projectId: 'proj-1',
      runProbe
    });
    expect(runProbe).toHaveBeenCalledTimes(FORMAT_PROBE_MAX_PER_MINUTE);
    expect(limitedSameProject).toEqual({
      kind: 'rate-limited',
      lastProjectDiagnosis: fakeDiagnosis('d-3')
    });

    // Danh sách khác chưa có chẩn đoán gần nhất → trả null để dùng câu chung.
    const limitedOtherProject = await guard.probe({
      videoKey: 'youtube:v5:0',
      platform: 'youtube',
      projectId: 'proj-2',
      runProbe
    });
    expect(limitedOtherProject).toEqual({ kind: 'rate-limited', lastProjectDiagnosis: null });

    // Nền tảng khác vẫn có hạn mức riêng.
    const tiktok = await guard.probe({
      videoKey: 'tiktok:t1:0',
      platform: 'tiktok',
      projectId: 'proj-1',
      runProbe
    });
    expect(tiktok.kind).toBe('probed');
    expect(runProbe).toHaveBeenCalledTimes(FORMAT_PROBE_MAX_PER_MINUTE + 1);

    // Qua 1 phút → YouTube được dò lại.
    now += FORMAT_PROBE_WINDOW_MS + 1;
    const afterWindow = await guard.probe({
      videoKey: 'youtube:v6:0',
      platform: 'youtube',
      projectId: 'proj-1',
      runProbe
    });
    expect(afterWindow.kind).toBe('probed');
    expect(runProbe).toHaveBeenCalledTimes(FORMAT_PROBE_MAX_PER_MINUTE + 2);
  });

  it('không dò khi nền tảng đang bị 429 hoặc chặn bot', async () => {
    const guard = new FormatProbeGuard({ isPlatformBlocked: (platform) => platform === 'youtube' });
    const runProbe = vi.fn(() => Promise.resolve(fakeProbe(720)));

    const outcome = await guard.probe({
      videoKey: 'youtube:blocked:0',
      platform: 'youtube',
      projectId: 'proj-1',
      runProbe
    });
    expect(runProbe).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('platform-blocked');
  });
});
