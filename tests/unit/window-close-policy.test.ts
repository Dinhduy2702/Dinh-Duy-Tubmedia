import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideCloseAction, decideMinimizeAction } from '../../src/main/app/window-close-policy.js';

// Khám phá bản cài 2026-10-05, vấn đề #3: công tắc "Thu nhỏ xuống khay hệ thống" lấn át ô "Khi đóng ứng dụng"
// (index.ts: `closeBehavior === 'tray' || minimizeToTray`) — bấm X luôn ẩn xuống khay dù chọn "Luôn hỏi",
// để lại tiến trình chạy ẩn. Quyết định của người dùng: nút X CHỈ theo ô "Khi đóng ứng dụng"; công tắc chỉ
// áp dụng cho nút thu nhỏ (—); "Luôn hỏi" mà không có tác vụ nào chạy thì đóng hẳn ngay.

describe('nút X chỉ theo ô "Khi đóng ứng dụng"', () => {
  it('"Luôn hỏi" + không có tác vụ → thoát hẳn, dù công tắc khay đang bật như máy thật (công tắc không còn là đầu vào của nút X)', () => {
    expect(decideCloseAction({ closeBehavior: 'ask', activeCount: 0 })).toBe('quit');
  });

  it('"Luôn hỏi" + có tác vụ → hỏi, không ẩn xuống khay', () => {
    expect(decideCloseAction({ closeBehavior: 'ask', activeCount: 3 })).toBe('ask');
  });

  it('"Tạm dừng và đóng" / "Hủy và đóng" làm đúng lựa chọn, không ẩn xuống khay', () => {
    expect(decideCloseAction({ closeBehavior: 'pause_and_exit', activeCount: 2 })).toBe('pause_and_exit');
    expect(decideCloseAction({ closeBehavior: 'cancel_and_exit', activeCount: 2 })).toBe('cancel_and_exit');
    expect(decideCloseAction({ closeBehavior: 'pause_and_exit', activeCount: 0 })).toBe('quit');
    expect(decideCloseAction({ closeBehavior: 'cancel_and_exit', activeCount: 0 })).toBe('quit');
  });

  it('chỉ khi ô "Khi đóng ứng dụng" = "Thu nhỏ xuống khay" thì X mới ẩn xuống khay', () => {
    expect(decideCloseAction({ closeBehavior: 'tray', activeCount: 0 })).toBe('hide-to-tray');
    expect(decideCloseAction({ closeBehavior: 'tray', activeCount: 5 })).toBe('hide-to-tray');
  });
});

describe('công tắc "Thu nhỏ xuống khay hệ thống" chỉ áp dụng cho nút thu nhỏ (—)', () => {
  it('bật → nút thu nhỏ ẩn xuống khay; tắt → thu nhỏ bình thường xuống thanh tác vụ', () => {
    expect(decideMinimizeAction({ minimizeToTray: true })).toBe('hide-to-tray');
    expect(decideMinimizeAction({ minimizeToTray: false })).toBe('default');
  });
});

describe('index.ts dùng đúng chính sách (test canh mã nguồn)', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
  const requestClose = source.slice(source.indexOf('async function requestClose'), source.indexOf('function wireWindow'));

  it('requestClose đi qua decideCloseAction và không còn tự đọc minimizeToTray', () => {
    expect(requestClose).toContain('decideCloseAction(');
    expect(requestClose).not.toContain('minimizeToTray');
  });

  it('nhánh "thoát hẳn" gọi app.quit() — không trông vào window-all-closed (bị bỏ qua khi đã có biểu tượng khay)', () => {
    // Thử thật trên bản dev 2026-10-05: sau khi đã thu nhỏ xuống khay một lần (hoặc công tắc bật từ lúc mở app),
    // window.close() đóng cửa sổ nhưng `window-all-closed` thấy `tray` nên KHÔNG thoát → app vẫn chạy ẩn.
    const quitBranch = requestClose.slice(requestClose.indexOf("action === 'quit'"), requestClose.indexOf("action === 'ask'"));
    expect(quitBranch).toContain('app.quit()');
    expect(quitBranch).not.toContain('window.close()');
  });

  it('cửa sổ có xử lý sự kiện thu nhỏ qua decideMinimizeAction', () => {
    expect(source).toMatch(/\.on\('minimize'/);
    expect(source).toContain('decideMinimizeAction(');
  });

  it('nhãn công tắc trong Cài đặt nói rõ là nút thu nhỏ, không còn trùng chữ với lựa chọn của nút X', () => {
    const settings = readFileSync(join(process.cwd(), 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8');
    expect(settings).toContain('Nút thu nhỏ (—) ẩn xuống khay hệ thống');
    expect(settings).not.toContain('<Toggle label="Thu nhỏ xuống khay hệ thống"');
  });
});
