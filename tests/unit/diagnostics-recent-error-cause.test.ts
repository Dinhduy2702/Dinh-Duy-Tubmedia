import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ytDlpFailureLogMessage } from '../../src/shared/utils/download-failure.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';

// Đợt 5 mục 14 (rà soát bản cài 2026-10-02): Chẩn đoán → "Lỗi gần nhất" chỉ ghi "yt-dlp không hoàn tất được video…",
// không nêu nguyên nhân (403) trong khi thông báo nổi lại biết là 403. Nhật ký YTDLP_DOWNLOAD_FAILED ghi một câu chung cho
// MỌI nguyên nhân; nguyên nhân thật chỉ nằm trong metadata (failureSubtype, httpStatus).

describe('ytDlpFailureLogMessage — câu nhật ký nêu nguyên nhân đã phân loại', () => {
  it('nêu đúng nguyên nhân cho từng loại', () => {
    expect(ytDlpFailureLogMessage('http_403')).toContain('HTTP 403');
    expect(ytDlpFailureLogMessage('http_429')).toContain('HTTP 429');
    expect(ytDlpFailureLogMessage('fragment')).toContain('gián đoạn');
    expect(ytDlpFailureLogMessage('network')).toContain('mạng');
    expect(ytDlpFailureLogMessage('unsupported_url')).toContain('không phải trang video');
    expect(ytDlpFailureLogMessage('unavailable')).toContain('không khả dụng');
  });

  it('loại lạ / không có → vẫn có câu, nói rõ chưa xác định được', () => {
    expect(ytDlpFailureLogMessage(null)).toContain('chưa xác định');
    expect(ytDlpFailureLogMessage('unknown')).toContain('chưa xác định');
  });

  it('giao diện đọc câu này ra tiêu đề cụ thể (403 → "Máy chủ video tạm thời từ chối tải"), không phải tiêu đề chung', () => {
    expect(friendlyIssue(ytDlpFailureLogMessage('http_403')).title).toBe('Máy chủ video tạm thời từ chối tải');
    expect(friendlyIssue(ytDlpFailureLogMessage('unsupported_url')).title).toBe('Liên kết không phải trang video');
  });
});

describe('mọi nguyên nhân đều ra tiêu đề cụ thể', () => {
  it('không loại nào còn tiêu đề chung "Không thể hoàn tất thao tác"', () => {
    for (const subtype of [
      'disk_full', 'tool_missing', 'http_429', 'authentication', 'removed', 'unsupported_url',
      'unavailable', 'http_403', 'fragment', 'extractor', 'network', 'unknown'
    ] as const) {
      expect(friendlyIssue(ytDlpFailureLogMessage(subtype)).title, subtype).not.toBe('Không thể hoàn tất thao tác');
    }
    expect(friendlyIssue(ytDlpFailureLogMessage('http_429')).message).toContain('HTTP 429');
  });
});

describe('nối vào nhật ký và trang Chẩn đoán', () => {
  const read = (path: string): string => readFileSync(path, 'utf8');

  it('DownloadEngine ghi YTDLP_DOWNLOAD_FAILED bằng câu có nguyên nhân', () => {
    const engine = read('src/main/downloader/download-engine.ts');
    expect(engine).toContain('ytDlpFailureLogMessage(failure.subtype)');
  });

  it('Chẩn đoán dựng lại nguyên nhân từ metadata cho cả dòng nhật ký CŨ (ghi câu chung trước bản sửa)', () => {
    const page = read('src/renderer/src/pages/DiagnosticsPage.tsx');
    expect(page).toContain('diagnosticMessage(entry)');
    expect(page).toContain('failureSubtypeFromDetails(entry.metadata)');
  });

  it('"Lỗi gần nhất" xếp mới nhất trước theo thời gian ghi (không theo thứ tự trong kho)', () => {
    const page = read('src/renderer/src/pages/DiagnosticsPage.tsx');
    expect(page).toContain('.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))');
  });
});
