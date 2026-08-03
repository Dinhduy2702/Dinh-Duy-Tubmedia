import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string => readFileSync(join(process.cwd(), relativePath), 'utf8');

const shared = read('src/shared/quick-download.ts');
const command = read('src/main/download/quick-download-command.ts');
const service = read('src/main/download/quick-download-service.ts');
const context = read('src/main/app/app-context.ts');
const ipc = read('src/main/ipc/register-ipc.ts');
const panel = read('src/renderer/src/components/QuickDownloadPanel.tsx');

describe('Tải nhanh dùng chung hệ thống cookies', () => {
  it('phân loại lỗi xác thực và không trả lỗi yt-dlp thô cho giao diện', () => {
    expect(shared).toContain('QuickDownloadErrorCode');
    expect(service).toContain('classifyCookieFailure(');
    expect(service).toContain("'AUTHENTICATION_REQUIRED'");
    expect(service).toContain("'COOKIES_EXPIRED'");
    expect(service).toContain("'BROWSER_COOKIE_DATABASE_LOCKED'");
    expect(service).toContain('cookieFailureMessage(');
  });

  it('chỉ gắn cookies sau khi nền tảng yêu cầu và tự thử lại một lần', () => {
    expect(service).toContain('QUICK_DOWNLOAD_COOKIES_ATTACHED_ON_DEMAND');
    expect(service).toContain('hasConfiguredCookies(this.cookieSettings())');
    expect(command).toContain("args.push('--cookies', authentication.cookiesFilePath)");
    expect(command).toContain("args.push('--cookies-from-browser', browserSpec)");
  });

  it('lưu cookies sẽ tự tiếp tục tác vụ Tải nhanh bị chặn', () => {
    expect(service).toContain('public async retryCookieBlocked()');
    expect(ipc).toContain('await ctx.quickDownload.retryCookieBlocked()');
    expect(context).toContain("join(this.userData, 'quick-download'),");
    expect(context).toContain('this.settings');
  });

  it('dùng cùng cửa sổ ba cách thêm cookies như các workflow khác', () => {
    expect(panel).toContain('CookieManagerDialog');
    expect(panel).toContain('Mở 3 cách thêm cookies');
    expect(panel).toContain('onConfigured={resumeAfterCookies}');
    expect(panel).toContain('quick-download-cookie-block');
  });
});
