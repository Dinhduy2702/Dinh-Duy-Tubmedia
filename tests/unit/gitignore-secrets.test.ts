import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const patterns = readFileSync(resolve(root, '.gitignore'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

describe('.gitignore chặn tệp chứa bí mật', () => {
  it.each(['.env', '.env.*', '*.pfx', '*.p12', '*.pem', '*.key'])('có mẫu %s', (pattern) => {
    expect(patterns).toContain(pattern);
  });

  it('git thật sự bỏ qua chứng chỉ, khóa riêng và tệp .env.*, nhưng không bỏ qua mã nguồn', () => {
    const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
    if (probe.status !== 0) return; // bản giải nén không có .git: chỉ kiểm tra mẫu ở trên
    const ignored = (path: string): boolean =>
      spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: root }).status === 0;

    for (const path of [
      '.env',
      '.env.local',
      '.env.production',
      'signing.pfx',
      'certs/tubmedia.p12',
      'certs/ca.pem',
      'private.key'
    ]) {
      expect(ignored(path), path).toBe(true);
    }
    for (const path of ['src/main/index.ts', 'package.json', 'resources/icon.png', 'docs/keyboard.md']) {
      expect(ignored(path), path).toBe(false);
    }
  });
});
