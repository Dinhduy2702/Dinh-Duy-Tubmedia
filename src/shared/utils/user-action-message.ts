/**
 * 1.8.0 (việc C, yêu cầu người dùng 2026-11-25): lỗi mà NGƯỜI DÙNG tự xử lý được phải hiện tiêu đề ngắn + các bước làm
 * đánh số, không bắt đọc nhật ký kỹ thuật.
 *
 * Quy ước chung (để đợt sau mở rộng ra toàn app): tiến trình chính dựng câu lỗi bằng formatUserActionMessage() — vẫn là
 * MỘT chuỗi (đi qua errorMessage của tác vụ, CSDL, nhật ký… như cũ, đọc thô vẫn hiểu); giao diện gọi friendlyIssue() →
 * parseUserActionMessage() tách lại thành tiêu đề / mô tả / các bước, và userActionShortcut() gợi ý nút mở đúng trang.
 *
 * Dạng chuỗi:
 *   <tiêu đề> — <mô tả>
 *   Cách xử lý:
 *   1. <bước 1>
 *   2. <bước 2>
 */
export interface UserActionMessage {
  title: string;
  summary: string;
  steps: string[];
}

export type UserActionPage = 'settings' | 'tools' | 'cleanup' | 'updates';

export interface UserActionShortcut {
  label: string;
  page: UserActionPage;
}

export const USER_ACTION_STEPS_HEADER = 'Cách xử lý:';
const TITLE_SEPARATOR = ' — ';

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function formatUserActionMessage(message: UserActionMessage): string {
  const steps = message.steps.map((step, index) => `${index + 1}. ${oneLine(step)}`);
  return [`${oneLine(message.title)}${TITLE_SEPARATOR}${oneLine(message.summary)}`, USER_ACTION_STEPS_HEADER, ...steps].join('\n');
}

export function parseUserActionMessage(text: string): UserActionMessage | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.indexOf(USER_ACTION_STEPS_HEADER);
  if (headerIndex !== 1) return null;
  const first = lines[0]!;
  const separator = first.indexOf(TITLE_SEPARATOR);
  if (separator <= 0) return null;
  const steps: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const step = /^\d+\.\s+(.+)$/.exec(line);
    if (!step) return null;
    steps.push(step[1]!);
  }
  if (steps.length === 0) return null;
  return {
    title: first.slice(0, separator).trim(),
    summary: first.slice(separator + TITLE_SEPARATOR.length).trim(),
    steps
  };
}

/** Nút đường tắt theo nơi bước ĐẦU TIÊN có chỉ chỗ trỏ tới (không cần mã hoá thêm gì vào câu lỗi). */
export function userActionShortcut(steps: readonly string[]): UserActionShortcut | null {
  for (const step of steps) {
    if (step.includes('Cài đặt ›')) return { label: 'Mở Cài đặt', page: 'settings' };
    if (step.includes('Trung tâm công cụ')) return { label: 'Mở Trung tâm công cụ', page: 'tools' };
    if (step.includes('Dọn rác hệ thống')) return { label: 'Mở Dọn rác hệ thống', page: 'cleanup' };
    if (step.includes('trang Cập nhật')) return { label: 'Mở trang Cập nhật', page: 'updates' };
  }
  return null;
}

/*
 * 1.8.0 (yêu cầu người dùng 2026-11-25: "lỗi app, lỗi code mới cần lưu để fix lại"): lỗi do CHÍNH ỨNG DỤNG (ngoại lệ không
 * lường trước, lỗi công cụ tải chưa phân loại được, tiến trình xử lý sập) không được đổ cho người dùng. Tiến trình chính tự
 * lưu báo cáo (auto-error-report.ts) rồi dựng câu bằng formatAppFaultMessage(); giao diện nhận ra qua parseAppFaultMessage()
 * và hiện thẻ "Lỗi của ứng dụng" + nút mở thư mục báo cáo. Dòng 1 là câu cho người dùng; phần sau "Chi tiết kỹ thuật:"
 * chỉ hiện trong mục Chi tiết (thu gọn).
 */
export const APP_FAULT_TITLE = 'Lỗi của ứng dụng';
export const APP_FAULT_DEFAULT_SUMMARY =
  'Tubmedia gặp lỗi ngoài dự kiến — không phải do bạn thao tác sai. Báo cáo lỗi đã được lưu tự động để sửa.';
const APP_FAULT_DETAIL_HEADER = 'Chi tiết kỹ thuật:';
const APP_FAULT_DETAIL_LIMIT = 2_000;

export interface AppFaultMessage {
  summary: string;
  technical: string;
}

export function formatAppFaultMessage(input: { summary?: string; technical?: string } = {}): string {
  const head = `${APP_FAULT_TITLE}${TITLE_SEPARATOR}${oneLine(input.summary ?? APP_FAULT_DEFAULT_SUMMARY)}`;
  const technical = (input.technical ?? '').trim().slice(0, APP_FAULT_DETAIL_LIMIT);
  return technical ? `${head}\n${APP_FAULT_DETAIL_HEADER}\n${technical}` : head;
}

export function parseAppFaultMessage(text: string): AppFaultMessage | null {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const prefix = `${APP_FAULT_TITLE}${TITLE_SEPARATOR}`;
  if (!normalized.startsWith(prefix)) return null;
  const newline = normalized.indexOf('\n');
  const summary = (newline < 0 ? normalized : normalized.slice(0, newline)).slice(prefix.length).trim();
  const rest = newline < 0 ? '' : normalized.slice(newline + 1).trim();
  const technical = rest.startsWith(APP_FAULT_DETAIL_HEADER) ? rest.slice(APP_FAULT_DETAIL_HEADER.length).trim() : rest;
  return { summary: summary || APP_FAULT_DEFAULT_SUMMARY, technical };
}
