import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Phần A rà soát giao diện (người dùng duyệt 2026-10-06): chữ giải thích dài không đứng cố định — icon ⓘ (InfoHint) hiện
// đủ khi rê chuột/focus; banner khu cách ly lúc mở app chuyển vào chuông; Tổng quan ghi đúng 6 danh sách.
// Kiểm tra toàn diện bằng e2e "Phần A giao diện" (quét chữ dài đang hiển thị trên mọi trang); bài này canh các điểm cố định.
const read = (path: string): string => readFileSync(path, 'utf8');

describe('Phần A — icon ⓘ thay chữ dài, banner khu cách ly vào chuông', () => {
  it('InfoHint: icon nhỏ, câu đầy đủ trong ô chú thích chỉ hiện khi rê chuột/focus, có aria-label', () => {
    // 2026-10-08: ô chú thích chuyển sang HoverTip dùng chung (tự chọn phía, nằm gọn trong cửa sổ) — xem tooltip-placement.test.ts.
    const hint = read('src/renderer/src/components/InfoHint.tsx');
    expect(hint).toContain('<HoverTip text={text}');
    const tip = read('src/renderer/src/components/HoverTip.tsx');
    expect(tip).toContain('aria-label={text}');
    expect(tip).toContain('onPointerEnter={show}');
    expect(tip).toContain('onFocus={show}');
  });

  it('lời nhắc khu cách ly không còn là banner — chỉ ghi vào chuông với id cố định', () => {
    const notice = read('src/renderer/src/components/StorageAttentionNotice.tsx');
    expect(notice).toContain('export function StorageAttentionNotice(): null');
    expect(notice).toContain('addBellNotification(');
    expect(notice).not.toContain('<aside');
    expect(read('src/renderer/src/components/NotificationCenter.tsx')).toContain("label: 'Xem khu cách ly'");
  });

  it('Tổng quan ghi đúng tối đa 6 danh sách (không còn "bốn")', () => {
    const home = read('src/renderer/src/pages/EditorHomePage.tsx');
    expect(home).toContain('tối đa 6 danh sách');
    expect(home).not.toContain('tối đa bốn danh sách');
  });

  it('Cài đặt → Kiểm tra: không còn câu sai "Tubmedia tự dọn" khu cách ly (đã sai từ mục 5)', () => {
    const settings = read('src/renderer/src/pages/SettingsPage.tsx');
    expect(settings).not.toContain('Tubmedia tự dọn sau khi hoàn tất, hủy hoặc xóa quy trình');
    expect(settings).toContain('Tubmedia không tự xóa khu cách ly');
  });
});
