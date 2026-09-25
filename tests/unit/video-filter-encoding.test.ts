import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/main/media/video-link-filter-service.ts'), 'utf8');

describe('lọc video theo link: mã hóa văn bản của yt-dlp', () => {
  it('ép UTF-8 cho yt-dlp giống ProcessManager để tiêu đề tiếng Việt không bị hỏng', () => {
    expect(source).toContain("env: processEnvironmentFor('yt-dlp')");
  });

  it('giải mã theo StringDecoder để ký tự đa byte không bị cắt ở ranh giới chunk', () => {
    expect(source).toContain("new StringDecoder('utf8')");
    expect(source).not.toContain("chunk.toString('utf8')");
  });
});
