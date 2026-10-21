import { PROGRESS_MARKER } from '../constants/app.js';
import { sanitizeYtDlpDiagnostic } from './download-failure.js';

// P4 (2026-10-21): trước đây lời nhắn của yt-dlp chỉ được lưu khi tải LỖI. Lượt tải 1JtdsqPbsXw mất 10 mảnh hình mà vẫn báo
// mã 0 nên không còn dấu vết nào. Gom các dòng đáng giữ (cảnh báo, lỗi, thử lại/bỏ qua mảnh, tổng số mảnh) để lưu cả khi
// tải thành công; bỏ dòng tiến độ và dòng đánh dấu nội bộ của Tubmedia.

const MAX_NOTES = 40;
const KEEP = /^(WARNING|ERROR):|\bfragments?\b|\bretrying\b|\bgot error\b|\bskipping\b/i;
const PROBLEM = /^(WARNING|ERROR):|\bretrying\b|\bgot error\b|\bskipping\b|\bnot found\b/i;

export interface YtDlpNoteCollector {
  push(line: string): void;
  lines(): string[];
  /** Có cảnh báo/lỗi/mảnh phải thử lại hay bị bỏ qua — chỉ dòng tổng số mảnh thì không tính. */
  hasProblems(): boolean;
}

export function createYtDlpNoteCollector(): YtDlpNoteCollector {
  const kept: string[] = [];
  const seen = new Set<string>();
  return {
    push(raw) {
      const line = raw.trim();
      if (!line || line.startsWith('__VDMSP_') || line.includes(PROGRESS_MARKER) || !KEEP.test(line)) return;
      const clean = sanitizeYtDlpDiagnostic(line, 300);
      if (seen.has(clean) || kept.length >= MAX_NOTES) return;
      seen.add(clean);
      kept.push(clean);
    },
    lines: () => [...kept],
    hasProblems: () => kept.some((line) => PROBLEM.test(line))
  };
}
