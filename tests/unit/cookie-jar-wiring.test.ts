import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(path, 'utf8');

// Đợt 1 mục 3 (2026-10-02): yt-dlp ghi ngược tệp truyền qua --cookies sau mỗi lần chạy. Mọi nơi chạy yt-dlp
// có cookies phải đi qua CookieJarStore.lease() (bản sao tạm riêng) rồi release(kết quả) — không được trao
// thẳng tệp gốc, nếu không nhiều tiến trình sẽ cùng ghi một tệp và app tưởng "cookies đã đổi".
describe('mọi nơi chạy yt-dlp có cookies đều dùng bản sao tạm', () => {
  const sites = [
    'src/main/downloader/download-engine.ts',
    'src/main/download/quick-download-service.ts',
    'src/main/download/preview-frame-service.ts'
  ];

  it.each(sites)('%s mượn bản sao qua cookieJar.lease và trả lại bằng release', (path) => {
    const text = source(path);
    expect(text).toContain('.lease(');
    expect(text).toContain('.release(');
    expect(text).toContain('setCookieJar(');
  });

  it('app nối cùng một CookieJarStore cho cookies, 3 nơi chạy yt-dlp và hàng đợi', () => {
    const context = source('src/main/app/app-context.ts');
    expect(context).toContain('new CookieJarStore(');
    expect(context).toContain('new CookieService(this.userData, this.settings, this.cookieJar)');
    for (const target of ['downloader', 'quickDownload', 'previewFrame', 'queue']) {
      expect(context).toContain(`this.${target}.setCookieJar(this.cookieJar)`);
    }
  });
});
