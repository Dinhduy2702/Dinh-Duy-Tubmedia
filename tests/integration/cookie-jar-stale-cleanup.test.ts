import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CookieJarStore } from '@main/cookies/cookie-jar-store.js';

let folder = '';
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

const uuidName = (): string => `${randomUUID()}.txt`;

describe('dọn bản sao cookies sót lại: chỉ xóa đúng tệp app tạo trong security\\cookie-runs', () => {
  it('chỉ xóa tệp <uuid>.txt nằm TRỰC TIẾP trong cookie-runs; mọi thứ khác giữ nguyên', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-stale-runs-'));
    const security = join(folder, 'security');
    const runs = join(security, 'cookie-runs');
    mkdirSync(join(runs, 'thu-muc-con'), { recursive: true });

    const stale = join(runs, uuidName());
    const keep = [
      join(security, 'cookies-managed.txt'),
      join(security, uuidName()), // đúng mẫu tên nhưng KHÔNG nằm trong cookie-runs
      join(runs, 'ghi-chu.txt'),
      join(runs, `${randomUUID()}.txt.bak`),
      join(runs, randomUUID()),
      join(runs, 'thu-muc-con', uuidName()) // nằm sâu hơn một cấp
    ];
    for (const path of [stale, ...keep]) writeFileSync(path, 'x');
    const directoryNamedLikeRun = join(runs, uuidName());
    mkdirSync(directoryNamedLikeRun);
    writeFileSync(join(directoryNamedLikeRun, 'ben-trong.txt'), 'x');

    await new CookieJarStore(security).cleanupStaleRuns();

    expect(existsSync(stale)).toBe(false);
    for (const path of keep) expect(existsSync(path), path).toBe(true);
    expect(existsSync(join(directoryNamedLikeRun, 'ben-trong.txt'))).toBe(true);
  });

  it('cookie-runs là liên kết (junction) trỏ sang thư mục khác: KHÔNG xóa gì ở thư mục đích', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-stale-runs-'));
    const security = join(folder, 'security');
    const elsewhere = join(folder, 'thu-muc-cua-nguoi-dung');
    mkdirSync(security, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    const victim = join(elsewhere, uuidName());
    writeFileSync(victim, 'tệp của người dùng');
    symlinkSync(elsewhere, join(security, 'cookie-runs'), 'junction');

    await new CookieJarStore(security).cleanupStaleRuns();

    expect(existsSync(victim)).toBe(true);
  });

  // Phát hiện khi phát hành 1.6.0 (2026-10-06): trên máy CI, thư mục tạm là tên ngắn 8.3 (C:\Users\RUNNER~1\…).
  // realpath() trả tên dài nên so với đường dẫn gốc bị lệch → tưởng cookie-runs là liên kết, không dọn gì.
  it.runIf(process.platform === 'win32')('đường dẫn dữ liệu dạng tên ngắn 8.3 (RUNNER~1) vẫn dọn đúng bản sao sót lại', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-stale-runs-'));
    const longParent = join(folder, 'thu-muc-du-lieu-ten-rat-dai');
    mkdirSync(join(longParent, 'security', 'cookie-runs'), { recursive: true });
    // windowsVerbatimArguments: nếu không, Node thoát dấu ngoặc kép thành \" và %~sI trả chuỗi rác thay vì tên ngắn.
    const shortParent = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${longParent}") do @echo %~sI`], {
      encoding: 'utf8',
      windowsVerbatimArguments: true
    }).stdout.trim();
    expect(existsSync(shortParent), `tên ngắn phải trỏ tới thư mục thật: ${shortParent}`).toBe(true);
    if (shortParent.toLowerCase() === longParent.toLowerCase()) return; // ổ không tạo tên 8.3 — không tái hiện được
    const stale = join(longParent, 'security', 'cookie-runs', uuidName());
    writeFileSync(stale, 'x');

    await new CookieJarStore(join(shortParent, 'security')).cleanupStaleRuns();

    expect(existsSync(stale)).toBe(false);
  });

  it('đường dẫn security cấu hình sai (tương đối/rỗng): không làm gì', async () => {
    await expect(new CookieJarStore('').cleanupStaleRuns()).resolves.toBeUndefined();
    await expect(new CookieJarStore('security').cleanupStaleRuns()).resolves.toBeUndefined();
    expect(existsSync(join(process.cwd(), 'cookie-runs'))).toBe(false);
  });
});
