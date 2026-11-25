import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diagnoseFormatUnavailable,
  parseFormatProbeOutput,
  summarizeAvailableFormats,
  type FormatUnavailableContext
} from '../../src/shared/utils/format-availability.js';
import { parseUserActionMessage, userActionShortcut } from '../../src/shared/utils/user-action-message.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { AppSettings } from '../../src/shared/types/domain.js';

// Dữ liệu thật `yt-dlp -J` (rút gọn chỉ mảng formats) của 3 video YouTube, tải 2026-11-25 trên máy dev nhận đủ định dạng.
function fixture(id: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'ytdlp-formats', `${id}.json`), 'utf8')) as unknown;
}

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...defaultAppSettings, ...patch };
}

function context(patch: Partial<FormatUnavailableContext>): FormatUnavailableContext {
  return {
    summary: null,
    settings: settings(),
    platform: 'youtube',
    platformLabel: 'YouTube',
    ytdlpVersion: '2026.10.26',
    jsRuntime: true,
    diagnosticText: 'ERROR: [youtube] x: Requested format is not available. Use --list-formats for a list of available formats',
    ...patch
  };
}

describe('1.8.0 việc C: đọc danh sách định dạng thật của nguồn', () => {
  it('7tZjr118TBs: tối đa 480p, bỏ qua ảnh xem trước (storyboard) và bản chỉ tiếng', () => {
    const summary = summarizeAvailableFormats(fixture('7tZjr118TBs'));
    expect(summary?.maxHeight).toBe(480);
    expect(summary?.maxFps).toBe(12);
    expect(summary?.codecs).toEqual(expect.arrayContaining(['H.264', 'VP9']));
    expect(summary?.hasAudio).toBe(true);
  });

  it('KBMTSf8_-K4: tối đa 478p, chỉ H.264; xXUk_wQr0WI: 1080p60 có AV1', () => {
    expect(summarizeAvailableFormats(fixture('KBMTSf8_-K4'))).toMatchObject({ maxHeight: 478, codecs: ['H.264'] });
    const hd = summarizeAvailableFormats(fixture('xXUk_wQr0WI'));
    expect(hd).toMatchObject({ maxHeight: 1080, maxFps: 60 });
    expect(hd?.codecs).toContain('AV1');
  });

  it('đọc được dòng JSON gọn của --print (kể cả có cảnh báo yt-dlp phía trước) ; dữ liệu hỏng → null', () => {
    const line = JSON.stringify([
      { format_id: 'sb0', vcodec: 'none', acodec: 'none', height: 180, fps: 1 },
      { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2' },
      { format_id: '18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, fps: 30 }
    ]);
    expect(parseFormatProbeOutput(`WARNING: x\n${line}\n`)).toMatchObject({ maxHeight: 360, maxFps: 30, codecs: ['H.264'] });
    expect(parseFormatProbeOutput('[{"format_id": ')).toBeNull();
    expect(parseFormatProbeOutput('')).toBeNull();
  });
});

describe('1.8.0 việc C: câu lỗi "không có định dạng" nêu đúng 1 trong 3 nguyên nhân', () => {
  it('1. nguồn thật chỉ có 480p, chế độ CapCut 1080p → chỉ ô cần bật, nêu con số', () => {
    const diagnosis = diagnoseFormatUnavailable(
      context({ summary: summarizeAvailableFormats(fixture('7tZjr118TBs')), settings: settings({ downloadCompatibilityMode: 'capcut_sdr_1080p' }) })
    );
    expect(diagnosis.cause).toBe('source_limited');
    expect(diagnosis.reason).toBe('height_below_minimum');
    const parsed = parseUserActionMessage(diagnosis.message);
    expect(parsed?.title).toBe('Nguồn chỉ có tối đa 480p');
    expect(parsed?.summary).toContain('cần từ 1080p');
    expect(parsed?.steps[0]).toBe('Mở Cài đặt › Tải danh sách.');
    expect(parsed?.steps[1]).toContain('Cho phép fallback thấp hơn mức tối thiểu khi nguồn không có');
    expect(parsed?.steps[1]).toContain('480p');
    expect(diagnosis.details).toMatchObject({ availableMaxHeight: 480, availableMaxFps: 12, ytdlpVersion: '2026.10.26', jsRuntime: true });
  });

  it('1. chế độ thủ công: tối đa / FPS / codec được nêu đúng ô', () => {
    const hd = summarizeAvailableFormats(fixture('xXUk_wQr0WI'));
    expect(diagnoseFormatUnavailable(context({ summary: hd, settings: settings({ downloadMinHeight: 1440 }) })).message).toContain(
      'Hạ "Độ phân giải tối thiểu" xuống 1080'
    );
    expect(diagnoseFormatUnavailable(context({ summary: hd, settings: settings({ downloadMaxHeight: 100 }) })).reason).toBe('height_above_maximum');
    const fps = diagnoseFormatUnavailable(context({ summary: summarizeAvailableFormats(fixture('7tZjr118TBs')), settings: settings({ downloadMinFps: 25 }) }));
    expect(fps.reason).toBe('fps_below_minimum');
    expect(fps.message).toContain('tối đa 12 FPS');
    const codec = diagnoseFormatUnavailable(
      context({ summary: summarizeAvailableFormats(fixture('KBMTSf8_-K4')), settings: settings({ downloadCodecPreference: 'av1' }) })
    );
    expect(codec.reason).toBe('codec_missing');
    expect(codec.message).toContain('không có bản codec AV1 (chỉ có H.264)');
  });

  it('2. YouTube chỉ trả ≤720p kèm dấu hiệu máy bị hạn chế → "máy này chỉ nhận được tối đa X p" + đổi mạng/cookie/cập nhật', () => {
    const summary = parseFormatProbeOutput(
      JSON.stringify([{ format_id: '18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, fps: 30 }])
    );
    const diagnosis = diagnoseFormatUnavailable(
      context({
        summary,
        jsRuntime: false,
        settings: settings({ downloadCompatibilityMode: 'capcut_sdr_1080p' }),
        diagnosticText: 'WARNING: [youtube] No supported JavaScript runtime could be found. ... some formats may be missing'
      })
    );
    expect(diagnosis.cause).toBe('machine_limited');
    const parsed = parseUserActionMessage(diagnosis.message);
    expect(parsed?.title).toBe('Máy này chỉ nhận được bản 360p');
    expect(parsed?.summary).toContain('yt-dlp 2026.10.26, không có bộ chạy JavaScript');
    expect(parsed?.steps.join(' ')).toContain('Đổi mạng');
    expect(parsed?.steps.join(' ')).toContain('Làm mới cookie');
    expect(parsed?.steps.join(' ')).toContain('cập nhật yt-dlp');
    // Ô "Cho phép thấp hơn" đang tắt → vẫn gợi ý lấy bản 360p.
    expect(parsed?.steps.at(-1)).toContain('để lấy bản 360p');
    expect(userActionShortcut(parsed?.steps ?? [])).toEqual({ label: 'Mở Trung tâm công cụ', page: 'tools' });
    expect(diagnosis.details.machineLimitSignals).toEqual(
      expect.arrayContaining(['no supported javascript runtime', 'some formats may be missing', 'no-bundled-js-runtime'])
    );
  });

  it('2. không có bản video nào → nói rõ nền tảng không trả bản video cho máy này', () => {
    const diagnosis = diagnoseFormatUnavailable(context({ summary: summarizeAvailableFormats([{ format_id: 'sb0', vcodec: 'none', height: 90 }]) }));
    expect(diagnosis.cause).toBe('machine_limited');
    expect(diagnosis.reason).toBe('no_video_formats');
    expect(parseUserActionMessage(diagnosis.message)?.title).toBe('YouTube không trả bản video cho máy này');
  });

  it('nguồn 480p thật trên máy CÓ bộ chạy JS và không có cảnh báo → là giới hạn của nguồn, không đổ cho máy', () => {
    const diagnosis = diagnoseFormatUnavailable(
      context({ summary: summarizeAvailableFormats(fixture('KBMTSf8_-K4')), settings: settings({ downloadMinHeight: 720 }) })
    );
    expect(diagnosis.cause).toBe('source_limited');
  });

  it('3. không đọc được danh sách định dạng → giữ câu cũ, thêm phiên bản yt-dlp', () => {
    const diagnosis = diagnoseFormatUnavailable(context({ summary: null }));
    expect(diagnosis.cause).toBe('probe_failed');
    const parsed = parseUserActionMessage(diagnosis.message);
    expect(parsed?.summary).toContain('không có định dạng nào khớp cài đặt chất lượng hiện tại');
    expect(parsed?.summary).toContain('yt-dlp 2026.10.26');
    expect(userActionShortcut(parsed?.steps ?? [])).toEqual({ label: 'Mở Cài đặt', page: 'settings' });
  });

  it('giao diện tách câu thành tiêu đề + các bước đánh số + nút mở đúng chỗ', () => {
    const diagnosis = diagnoseFormatUnavailable(
      context({ summary: summarizeAvailableFormats(fixture('7tZjr118TBs')), settings: settings({ downloadCompatibilityMode: 'capcut_sdr_1080p' }) })
    );
    const issue = friendlyIssue(diagnosis.message);
    expect(issue.title).toBe('Nguồn chỉ có tối đa 480p');
    expect(issue.steps).toHaveLength(3);
    expect(issue.steps[2]).toBe('Bấm Thử lại video này.');
    expect(issue.action).toEqual({ label: 'Mở Cài đặt', page: 'settings' });
  });
});
