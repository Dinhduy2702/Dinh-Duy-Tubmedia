import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '') }, shell: { showItemInFolder: vi.fn() } }));

import { CookiesExpiredError } from '../../src/shared/errors/app-errors.js';
import { quickCookieFailureMessage } from '../../src/main/download/quick-download-service.js';

// 1.7.6 việc B: câu thật của yt-dlp khi trình duyệt đã xoay cookie (nhật ký 03/11).
const ROTATED_LINES = [
  'WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure. For tips on how to effectively export YouTube cookies, refer to https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies .',
  "ERROR: [youtube] abc123def45: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication."
];

describe('cookie bị trình duyệt xoay', () => {
  it('lỗi hàng đợi: nói rõ bị xoay + cách xuất từ cửa sổ ẩn danh rồi đóng ngay', () => {
    const message = new CookiesExpiredError({ failureSubtype: 'cookies_invalid' }).message;
    expect(message).toMatch(/xoay/i);
    expect(message).toMatch(/ẩn danh/i);
    expect(message).toMatch(/đóng/i);
  });

  it('lỗi hàng đợi hết hạn thường: giữ câu cũ', () => {
    expect(new CookiesExpiredError({ failureSubtype: 'authentication' }).message).not.toMatch(/xoay/i);
  });

  it('Tải nhanh: cùng câu yt-dlp → thông báo nói bị xoay + ẩn danh; không có câu xoay → câu hết hạn cũ', () => {
    const rotated = quickCookieFailureMessage('COOKIES_EXPIRED', ROTATED_LINES);
    expect(rotated).toMatch(/xoay/i);
    expect(rotated).toMatch(/ẩn danh/i);
    const plain = quickCookieFailureMessage('COOKIES_EXPIRED', [ROTATED_LINES[1]!]);
    expect(plain).not.toMatch(/xoay/i);
  });
});
