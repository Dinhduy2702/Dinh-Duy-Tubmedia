import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isYtDlpExecutable, YtDlpRuntimeTemp } from '../../src/main/processes/ytdlp-runtime-temp.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('isYtDlpExecutable — nhận yt-dlp theo tên tệp chạy (cả bản kiểm tra sức khỏe / kiểm bản cập nhật)', () => {
  it('nhận đúng yt-dlp, không nhầm công cụ khác', () => {
    expect(isYtDlpExecutable('C:\\Tools\\yt-dlp.exe')).toBe(true);
    expect(isYtDlpExecutable('C:\\Users\\Hi\\AppData\\Roaming\\x\\tools\\current\\YT-DLP.EXE')).toBe(true);
    expect(isYtDlpExecutable('/usr/local/bin/yt-dlp')).toBe(true);
    expect(isYtDlpExecutable('C:\\Tools\\yt-dlp.exe.new-1234')).toBe(true);
    expect(isYtDlpExecutable('C:\\Tools\\ffmpeg.exe')).toBe(false);
    expect(isYtDlpExecutable('C:\\yt-dlp-folder\\aria2c.exe')).toBe(false);
    expect(isYtDlpExecutable('taskkill.exe')).toBe(false);
  });
});

describe('YtDlpRuntimeTemp', () => {
  it('mỗi lần cấp một thư mục riêng, TMP/TEMP trỏ vào đó; giải phóng thì xóa sạch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-ytdlp-rt-'));
    folders.push(root);
    const runtime = new YtDlpRuntimeTemp(root);

    const first = await runtime.allocate();
    const second = await runtime.allocate();
    expect(first.dir).not.toBe(second.dir);
    expect(first.env.TMP).toBe(first.dir);
    expect(first.env.TEMP).toBe(first.dir);
    await mkdir(join(first.dir, '_MEI12345', 'lib'), { recursive: true });
    await writeFile(join(first.dir, '_MEI12345', 'lib', 'python.dll'), 'x');

    await first.release();
    expect(existsSync(first.dir)).toBe(false);
    expect(existsSync(second.dir)).toBe(true);
    await second.release();
    await second.release();
    expect(await readdir(root)).toEqual([]);
  });

  it('dọn thư mục không còn ai dùng (kể cả mới vài phút — app bị tắt giữa lúc tải), giữ thư mục vừa cấp chưa đủ tuổi', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-ytdlp-rt-'));
    folders.push(root);
    const runtime = new YtDlpRuntimeTemp(root);
    const leftover = await runtime.allocate();
    const justAllocated = await runtime.allocate();
    await mkdir(join(leftover.dir, '_MEI1', 'lib'), { recursive: true });
    await writeFile(join(leftover.dir, '_MEI1', 'lib', 'python.dll'), 'x');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await utimes(leftover.dir, fiveMinutesAgo, fiveMinutesAgo);

    const removed = await runtime.sweepUnused(60_000);

    expect(removed).toBe(1);
    expect(existsSync(leftover.dir)).toBe(false);
    expect(existsSync(justAllocated.dir), 'thư mục vừa cấp (tiến trình chưa kịp chạy) không được xóa').toBe(true);
    expect((await readdir(root)).filter((name) => name.includes('.removing'))).toEqual([]);
  });

  it('thư mục gốc chưa tồn tại → dọn không lỗi, trả 0', async () => {
    const runtime = new YtDlpRuntimeTemp(join(tmpdir(), 'tubmedia-ytdlp-rt-khong-co-' + Date.now()));
    expect(await runtime.sweepUnused()).toBe(0);
  });
});
