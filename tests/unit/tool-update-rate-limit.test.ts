import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

const mainFiles = walk(join(process.cwd(), 'src', 'main'));
const servicePath = mainFiles.find((filePath) => {
  const source = readFileSync(filePath, 'utf8');
  return source.includes('class ToolUpdateService') && source.includes('githubLatest');
});

if (!servicePath) {
  throw new Error('Không tìm thấy ToolUpdateService.');
}

const source = readFileSync(servicePath, 'utf8');

describe('kiểm tra cập nhật công cụ không làm tràn giới hạn GitHub', () => {
  it('gộp yêu cầu, cache kết quả và tôn trọng thời gian chờ', () => {
    expect(source).toContain('tubmediaGitHubReleaseInflight');
    expect(source).toContain('TUBMEDIA_GITHUB_RELEASE_CACHE_TTL_MS');
    expect(source).toContain('x-ratelimit-reset');
    expect(source).toContain('retry-after');
  });

  it('gửi header GitHub hợp lệ và có nguồn HTML dự phòng', () => {
    expect(source).toContain("'User-Agent'");
    expect(source).toContain("'X-GitHub-Api-Version'");
    expect(source).toContain('tubmediaGitHubHtmlReleaseFallback');
    expect(source).toContain('/releases/expanded_assets/');
  });

  it('không nhúng token GitHub bí mật vào source', () => {
    expect(source).toContain('process.env.GITHUB_TOKEN');
    expect(source).toContain('process.env.GH_TOKEN');
    expect(source).not.toMatch(/gh[pousr]_[A-Za-z0-9_]{20,}/);
  });
});
