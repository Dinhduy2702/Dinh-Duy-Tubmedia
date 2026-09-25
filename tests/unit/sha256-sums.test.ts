import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSha256InSums } from '../../src/shared/utils/sha256-sums.js';

const YTDLP = 'A'.repeat(64);
const ZIP = 'b'.repeat(64);

describe('findSha256InSums', () => {
  it('đọc định dạng sha256sum hai khoảng trắng và trả về chữ thường', () => {
    const text = `${'1'.repeat(64)}  yt-dlp\n${YTDLP}  yt-dlp.exe\n`;
    expect(findSha256InSums(text, 'yt-dlp.exe')).toBe(YTDLP.toLowerCase());
  });

  it('chấp nhận dấu * của chế độ nhị phân, CRLF và BOM', () => {
    const bom = String.fromCharCode(0xfeff);
    const text = `${bom}${ZIP} *ffmpeg-master-latest-win64-gpl.zip\r\n`;
    expect(findSha256InSums(text, 'ffmpeg-master-latest-win64-gpl.zip')).toBe(ZIP);
  });

  it('không khớp một phần tên tệp (gpl-shared khác gpl)', () => {
    const text = `${ZIP}  ffmpeg-master-latest-win64-gpl-shared.zip\n`;
    expect(findSha256InSums(text, 'ffmpeg-master-latest-win64-gpl.zip')).toBeNull();
  });

  it('bỏ qua dòng không hợp lệ hoặc hash sai độ dài', () => {
    const text = `not a checksum\n${'c'.repeat(63)}  yt-dlp.exe\n`;
    expect(findSha256InSums(text, 'yt-dlp.exe')).toBeNull();
  });
});

describe('tool-update-service', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/updates/tool-update-service.ts'), 'utf8');

  it('không còn placeholder ${targetVersion} chưa được thay trong User-Agent', () => {
    expect(source).not.toContain('${targetVersion}');
  });

  it('tải bằng pipeline để lỗi mạng giữa chừng không làm treo tiến trình', () => {
    expect(source).toContain('await pipeline(Readable.fromWeb');
    expect(source).not.toContain('finished(');
  });
});
