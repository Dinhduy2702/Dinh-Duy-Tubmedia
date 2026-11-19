import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeSandbox } from '../e2e/helpers/sandbox-cleanup.js';

/**
 * Phát hành 1.7.0 (run 38865391717) và 1.6.1 (run 37748960748) đều trượt ở BƯỚC DỌN của một bài e2e: xóa sandbox báo EPERM
 * vì trên máy CI vẫn còn thứ giữ thư mục lâu hơn ~11 giây mà fs.rmSync(maxRetries 10) chịu được — bộ e2e chạy nối tiếp
 * nên một thư mục tạm không xóa được làm "did not run" mọi bài phía sau và chặn phát hành. Giả lập khóa bằng một tiến trình
 * con lấy thư mục làm cwd (Windows không cho xóa thư mục đang là cwd của tiến trình khác).
 */
const holders: ChildProcess[] = [];

function holdDirectory(directory: string, milliseconds: number): ChildProcess {
  const child = spawn(
    process.execPath,
    ['-e', `process.stdout.write('READY\\n'); setTimeout(() => {}, ${milliseconds});`],
    {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    }
  );
  holders.push(child);
  return child;
}

function makeSandbox(): string {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-sandbox-cleanup-test-'));
  fs.mkdirSync(path.join(directory, 'userdata', 'database'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'userdata', 'database', 'studio.sqlite'), 'x');
  return directory;
}

async function waitForDirectoryHeld(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error(`Quá ${timeoutMs}ms mà tiến trình con giữ thư mục chưa báo READY.`));
    }, timeoutMs);
    child.once('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
    child.once('close', (code) => finish(new Error(`Tiến trình con giữ thư mục thoát sớm (mã ${code ?? -1}) trước khi báo READY.`)));
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.includes('READY')) finish();
    });
  });
}

afterEach(() => {
  for (const child of holders.splice(0)) child.kill();
});

describe.runIf(process.platform === 'win32')('removeSandbox (bước dọn của bài e2e)', () => {
  it('chờ được khóa giữ lâu hơn ~11 giây (ngưỡng cũ) rồi xóa sạch', async () => {
    const sandbox = makeSandbox();
    await waitForDirectoryHeld(holdDirectory(sandbox, 14_000));
    const result = await removeSandbox(sandbox);
    expect(fs.existsSync(sandbox), 'thư mục đã được xóa sau khi khóa nhả').toBe(false);
    expect(result).toMatchObject({ removed: true });
  }, 60_000);

  it('khóa giữ mãi quá hạn chờ thì KHÔNG ném lỗi (không đánh rớt bài kiểm), trả về chẩn đoán', async () => {
    const sandbox = makeSandbox();
    await waitForDirectoryHeld(holdDirectory(sandbox, 30_000));
    let result: Awaited<ReturnType<typeof removeSandbox>> | undefined;
    await expect(
      (async () => {
        result = await removeSandbox(sandbox, { budgetMs: 2_000 });
      })()
    ).resolves.toBeUndefined();
    expect(result).toMatchObject({ removed: false });
    expect((result as unknown as { error: string }).error).toMatch(/EPERM|EBUSY|ENOTEMPTY/);
    for (const child of holders.splice(0)) child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }, 60_000);
});
