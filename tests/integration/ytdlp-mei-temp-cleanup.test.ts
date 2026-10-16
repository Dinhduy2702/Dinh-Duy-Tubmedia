import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProcessManager } from '../../src/main/processes/process-manager.js';
import { YtDlpRuntimeTemp } from '../../src/main/processes/ytdlp-runtime-temp.js';
import { silentLogger } from './helpers/real-ffmpeg.js';

/**
 * 2026-10-15: %TEMP% máy dev có 980 thư mục _MEI* (21,4 GB) — yt-dlp.exe là bản PyInstaller một tệp, tiến trình mồi giải
 * nén vào %TEMP%\_MEIxxxx và chỉ tự dọn khi thoát bình thường. App dừng yt-dlp bằng `taskkill /T /F` (tạm dừng, hủy, quá
 * giờ, đóng app) nên mỗi lần dừng ngang để sót ~20 MB. Đo thật: thoát bình thường không sót; bị taskkill /F sót 1 thư mục.
 * Sửa: mỗi tiến trình yt-dlp có thư mục tạm riêng (TMP/TEMP), xóa khi tiến trình kết thúc dù thoát kiểu gì.
 */
const ytDlp = join(process.cwd(), 'tool', 'yt-dlp.exe');
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function entries(root: string): Promise<string[]> {
  return existsSync(root) ? readdir(root) : [];
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

async function meiFolders(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of await entries(root)) {
    for (const child of await entries(join(root, dir))) if (child.startsWith('_MEI')) found.push(join(dir, child));
  }
  return found;
}

describe.skipIf(!existsSync(ytDlp) || process.platform !== 'win32')('yt-dlp không để sót thư mục _MEI khi bị dừng ngang (yt-dlp thật)', () => {
  it('bị hủy giữa chừng (taskkill /T /F) → thư mục tạm riêng của tiến trình bị xóa, không sót _MEI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-mei-test-'));
    folders.push(root);
    const processes = new ProcessManager(silentLogger, new YtDlpRuntimeTemp(root));
    const controller = new AbortController();

    const running = processes.run({
      jobId: 'mei-kill',
      tool: 'yt-dlp',
      executablePath: ytDlp,
      args: ['--help'],
      signal: controller.signal
    });
    const extracted = await waitFor(async () => (await meiFolders(root)).length > 0, 15_000);
    expect(extracted, 'yt-dlp phải giải nén vào thư mục tạm riêng do app cấp (TMP/TEMP)').toBe(true);
    controller.abort();
    await expect(running).rejects.toThrow();

    const cleaned = await waitFor(async () => (await entries(root)).length === 0, 10_000);
    expect(cleaned, `còn sót: ${(await meiFolders(root)).join(', ')}`).toBe(true);
  }, 60_000);

  it('dọn thư mục không còn ai dùng: KHÔNG đụng thư mục của yt-dlp đang chạy (bị khóa), xóa thư mục sót của phiên trước', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-mei-test-'));
    folders.push(root);
    const runtime = new YtDlpRuntimeTemp(root);
    // Thư mục sót của "phiên trước": có _MEI, không tiến trình nào giữ.
    const leftover = await runtime.allocate();
    await mkdir(join(leftover.dir, '_MEI999'), { recursive: true });
    await writeFile(join(leftover.dir, '_MEI999', 'python313.dll'), 'x');
    // yt-dlp đang chạy thật: máy chủ cục bộ không bao giờ trả lời → tiến trình sống tới khi bị hủy.
    let requests = 0;
    const server = createServer(() => void (requests += 1));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const processes = new ProcessManager(silentLogger, runtime);
    const controller = new AbortController();
    const running = processes.run({
      jobId: 'mei-live',
      tool: 'yt-dlp',
      executablePath: ytDlp,
      args: ['--socket-timeout', '60', `http://127.0.0.1:${port}/x.mp4`],
      signal: controller.signal
    });
    try {
      // Chờ tới khi yt-dlp THỰC SỰ chạy (đã gửi yêu cầu tới máy chủ) — trong lúc còn giải nén, thư mục _MEI chưa bị khóa
      // (đo 2026-10-16: dọn ngay khi _MEI vừa xuất hiện thì đổi tên được, ~1/3 lượt). Khoảng giải nén do ngưỡng tuổi tối thiểu
      // (1 phút) che ở app thật — kiểm ở unit test ytdlp-runtime-temp (giữ thư mục vừa cấp chưa đủ tuổi).
      expect(await waitFor(() => Promise.resolve(requests > 0), 30_000), 'yt-dlp phải gửi được yêu cầu').toBe(true);
      const live = (await meiFolders(root)).find((name) => !name.includes('_MEI999'))!;

      const removed = await runtime.sweepUnused(0);

      expect(removed, 'chỉ xóa thư mục sót').toBe(1);
      expect(existsSync(leftover.dir)).toBe(false);
      expect(existsSync(join(root, live)), 'thư mục của yt-dlp đang chạy phải còn nguyên').toBe(true);
      expect(processes.count(), 'yt-dlp vẫn đang chạy').toBe(1);
    } finally {
      controller.abort();
      await running.catch(() => undefined);
      server.close();
    }
    expect(await waitFor(async () => (await entries(root)).length === 0, 10_000)).toBe(true);
  }, 60_000);

  it('thoát bình thường → không còn thư mục tạm nào', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-mei-test-'));
    folders.push(root);
    const processes = new ProcessManager(silentLogger, new YtDlpRuntimeTemp(root));

    const result = await processes.run({ jobId: 'mei-normal', tool: 'yt-dlp', executablePath: ytDlp, args: ['--version'] });

    expect(result.code).toBe(0);
    expect(await waitFor(async () => (await entries(root)).length === 0, 10_000)).toBe(true);
  }, 60_000);
});
