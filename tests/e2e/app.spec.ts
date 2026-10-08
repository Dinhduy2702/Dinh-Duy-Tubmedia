/// <reference lib="dom" />
// Chỉ tệp này cần kiểu DOM (page.evaluate chạy trong ngữ cảnh trình duyệt của cửa sổ Electron) —
// tham chiếu ba gạch chéo chỉ áp dụng cho tệp này, không đổi "lib" chung của tsconfig.node.json
// (giữ nguyên cho code tiến trình chính không có DOM).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
  main?: string;
  productName?: string;
};

const mainEntry = path.resolve(projectRoot, packageJson.main ?? 'out/main/index.js');

const runtimeLogPath = path.join(projectRoot, 'test-results', 'electron-shell-runtime.log');

let electronApplication: ElectronApplication | undefined;
let mainProcessId: number | undefined;
let shellWindow: Page | undefined;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function appendRuntimeLog(message: string): void {
  fs.mkdirSync(path.dirname(runtimeLogPath), {
    recursive: true
  });

  fs.appendFileSync(runtimeLogPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function forceKillProcessTree(processId: number | undefined): void {
  if (!processId || process.platform !== 'win32') {
    return;
  }

  try {
    execFileSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10_000
    });

    appendRuntimeLog(`Forced process-tree termination for PID ${processId}.`);
  } catch {
    // A nonzero exit is normal when Electron has already stopped.
  }
}

async function settleWithin(action: Promise<unknown>, timeoutMilliseconds: number): Promise<void> {
  await Promise.race([
    action.then(
      () => undefined,
      () => undefined
    ),
    sleep(timeoutMilliseconds)
  ]);
}

async function closeElectronApplication(): Promise<void> {
  const application = electronApplication;
  const processId = mainProcessId;

  electronApplication = undefined;
  shellWindow = undefined;
  mainProcessId = undefined;

  if (application) {
    await settleWithin(
      application
        .evaluate(({ app }) => {
          app.removeAllListeners('window-all-closed');
          app.exit(0);
        })
        .catch(() => undefined),
      3_000
    );

    await settleWithin(
      application.close().catch(() => undefined),
      5_000
    );
  }

  forceKillProcessTree(processId);
}

test.describe.configure({
  mode: 'serial',
  timeout: 90_000
});

test.beforeEach(() => {
  fs.rmSync(runtimeLogPath, {
    force: true
  });
});

test.afterEach(async () => {
  await closeElectronApplication();
});

test.afterAll(async () => {
  await closeElectronApplication();
});

test('opens the Download video Tubmedia desktop shell', async () => {
  expect(fs.existsSync(mainEntry), `Production Electron entry must exist: ${mainEntry}`).toBe(true);

  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );

  appendRuntimeLog(`Launching Electron entry: ${mainEntry}`);

  // An toàn dữ liệu (2026-10-02): trước đây bài kiểm này KHÔNG đặt TUBMEDIA_E2E_USER_DATA, nên bản dev dùng
  // thư mục mặc định %APPDATA%\video-download-merge-studio-pro — chính là dữ liệu THẬT của người dùng (CSDL,
  // hàng đợi, cookies). Mọi lần chạy e2e đều phải dùng thư mục tạm riêng như các bài kiểm còn lại.
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-shell-'));
  process.once('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));

  electronApplication = await electron.launch({
    args: [mainEntry],
    cwd: projectRoot,
    env: {
      ...cleanEnvironment,
      NODE_ENV: 'test',
      TUBMEDIA_E2E: '1',
      TUBMEDIA_E2E_USER_DATA: path.join(sandbox, 'userdata'),
      PLAYWRIGHT_TEST: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 45_000
  });

  mainProcessId = electronApplication.process().pid;

  appendRuntimeLog(`Electron main PID: ${String(mainProcessId)}`);

  electronApplication.on('console', (message) => {
    appendRuntimeLog(`[main:${message.type()}] ${message.text()}`);
  });

  shellWindow = await electronApplication.firstWindow({
    timeout: 30_000
  });

  shellWindow.on('console', (message) => {
    appendRuntimeLog(`[renderer:${message.type()}] ${message.text()}`);
  });

  shellWindow.on('pageerror', (error) => {
    appendRuntimeLog(`[renderer:pageerror] ${error.stack ?? error.message}`);
  });

  await shellWindow.waitForLoadState('domcontentloaded', {
    timeout: 30_000
  });

  await expect(shellWindow.locator('body')).toBeVisible({
    timeout: 15_000
  });

  const title = await shellWindow.title();

  appendRuntimeLog(`Window title: ${JSON.stringify(title)}`);

  expect(title.length).toBeGreaterThan(0);
  expect(title).toMatch(/Tubmedia|Download video/i);

  const bodyText = await shellWindow.locator('body').innerText({
    timeout: 15_000
  });

  expect(bodyText.trim().length).toBeGreaterThan(0);
});

/**
 * VẤN ĐỀ 1 (2026-09-22, người dùng báo khi dùng thử GĐ 2b): thêm/bớt link hoặc đổi số danh sách/quy
 * trình trên "Tải danh sách" và "Ghép theo Timeline" không được tự bắn thông báo nổi — chỉ báo khi có
 * sự kiện thật sự cần biết (bắt đầu tải, hoàn tất, lỗi thật). Bài kiểm tra này dùng Electron thật để xác
 * nhận: gõ/xoá nhiều dòng liên tục và bấm Thêm/Bớt danh sách (hoặc quy trình) nhiều lần liên tục KHÔNG
 * còn hiện thông báo nổi nào (".attention-center" không xuất hiện suốt quá trình).
 */
test('không bắn thông báo nổi khi sửa danh sách link hoặc đổi số danh sách/quy trình', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-notify-spam-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.close();

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    const noFloatingNotice = async (): Promise<void> => {
      await expect(shellWindow!.locator('.attention-center')).toHaveCount(0);
    };

    // -- Trang "Tải danh sách": gõ/xoá nhiều dòng liên tục, rồi bấm Thêm/Bớt danh sách nhiều lần.
    await shellWindow.evaluate(() =>
      document.querySelector<HTMLElement>('[data-page-id="download-workbench"]')?.click()
    );
    await shellWindow.waitForTimeout(400);
    const workbenchTextarea = shellWindow.locator('.lane-textarea').first();
    await workbenchTextarea.click();
    for (let index = 1; index <= 5; index += 1) {
      await workbenchTextarea.type(`https://www.youtube.com/watch?v=spam-check-${index}\n`, { delay: 5 });
    }
    await shellWindow.waitForTimeout(1_200);
    await noFloatingNotice();
    for (let index = 0; index < 6; index += 1) {
      await workbenchTextarea.press('Control+End');
      await workbenchTextarea.press('Backspace');
    }
    await shellWindow.waitForTimeout(1_200);
    await noFloatingNotice();

    const workbenchAddButton = shellWindow.getByRole('button', { name: 'Thêm danh sách' });
    const workbenchRemoveButton = shellWindow.getByRole('button', { name: 'Bớt danh sách' });
    for (let click = 0; click < 2; click += 1) {
      if (await workbenchAddButton.isEnabled().catch(() => false)) await workbenchAddButton.click();
      await shellWindow.waitForTimeout(150);
    }
    for (let click = 0; click < 2; click += 1) {
      if (await workbenchRemoveButton.isEnabled().catch(() => false)) await workbenchRemoveButton.click();
      await shellWindow.waitForTimeout(150);
    }
    await shellWindow.waitForTimeout(800);
    await noFloatingNotice();

    // -- Trang "Ghép theo Timeline": cùng kịch bản (dòng link + Thêm/Bớt quy trình).
    await shellWindow.evaluate(() =>
      document.querySelector<HTMLElement>('[data-page-id="download-merge"]')?.click()
    );
    await shellWindow.waitForTimeout(400);
    const mergeTextarea = shellWindow.locator('.merge-textarea').first();
    await mergeTextarea.click();
    for (let index = 1; index <= 5; index += 1) {
      await mergeTextarea.type(`https://www.youtube.com/watch?v=spam-check-${index}\n`, { delay: 5 });
    }
    await shellWindow.waitForTimeout(1_200);
    await noFloatingNotice();
    for (let index = 0; index < 6; index += 1) {
      await mergeTextarea.press('Control+End');
      await mergeTextarea.press('Backspace');
    }
    await shellWindow.waitForTimeout(1_200);
    await noFloatingNotice();

    const mergeAddButton = shellWindow.getByRole('button', { name: 'Thêm quy trình' });
    const mergeRemoveButton = shellWindow.getByRole('button', { name: 'Bớt quy trình' });
    for (let click = 0; click < 2; click += 1) {
      if (await mergeAddButton.isEnabled().catch(() => false)) await mergeAddButton.click();
      await shellWindow.waitForTimeout(150);
    }
    for (let click = 0; click < 2; click += 1) {
      if (await mergeRemoveButton.isEnabled().catch(() => false)) await mergeRemoveButton.click();
      await shellWindow.waitForTimeout(150);
    }
    await shellWindow.waitForTimeout(800);
    await noFloatingNotice();
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Giai đoạn 3 (2026-09-23) — "Tải theo khoảng có xem trước": kiểm tra THẬT đường ống trích khung hình xem
 * trước (yt-dlp tải một đoạn rất ngắn qua HTTP Range + ffmpeg trích 1 khung hình), dùng Electron thật với
 * máy chủ HTTP cục bộ (127.0.0.1) phát một clip testsrc do chính ffmpeg đã cài dựng ra — không mạng ngoài,
 * không cookie/tài khoản thật. Máy chủ hỗ trợ HTTP Range đúng chuẩn, mô phỏng đúng cách CDN thật hoạt
 * động khi tua video (yt-dlp giao việc tua cho ffmpeg với URL trực tiếp).
 */
function resolveToolsDirectoryForTest(): string | null {
  const needed = ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe'];
  const candidates = [
    path.join(projectRoot, 'tool'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Download video Tubmedia', 'resources', 'tool')
  ];
  for (const directory of candidates) {
    if (needed.every((name) => fs.existsSync(path.join(directory, name)))) return directory;
  }
  return null;
}

test('Giai đoạn 3: trích khung hình xem trước thật từ một đoạn ngắn (yt-dlp + ffmpeg thật, không mạng ngoài)', async () => {
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy yt-dlp/ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-preview-frame-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ytdlpPath: path.join(toolsDirectory!, 'yt-dlp.exe'),
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  const clipDirectory = path.join(sandbox, 'nguon-that');
  fs.mkdirSync(clipDirectory, { recursive: true });
  const clipPath = path.join(clipDirectory, 'clip.mp4');
  const ffmpegResult = spawnSync(
    path.join(toolsDirectory!, 'ffmpeg.exe'),
    ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=10:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', clipPath],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  expect(ffmpegResult.status, 'ffmpeg phải dựng được clip thử').toBe(0);
  const clipData = fs.readFileSync(clipPath);

  let server: Server | undefined;
  try {
    server = createServer((request, response) => {
      const range = request.headers.range;
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const start = match?.[1] ? Number(match[1]) : 0;
        const end = match?.[2] ? Number(match[2]) : clipData.length - 1;
        response.writeHead(206, {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${clipData.length}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes'
        });
        response.end(clipData.subarray(start, end + 1));
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(clipData.length),
        'Accept-Ranges': 'bytes'
      });
      response.end(clipData);
    });
    const port = await new Promise<number>((resolvePort) => {
      server!.listen(0, '127.0.0.1', () => resolvePort((server!.address() as { port: number }).port));
    });
    const clipUrl = `http://127.0.0.1:${port}/clip.mp4`;

    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    // tsconfig.node.json (dùng cho tệp này) không thấy được env.d.ts của renderer (khai báo window.desktop)
    // — ép kiểu NGAY TRONG hàm evaluate (chạy thật trong cửa sổ trình duyệt lúc runtime); không thể truyền
    // hàm ép kiểu như một đối số vào evaluate vì Playwright chỉ truyền được dữ liệu tuần tự hoá được.
    interface DesktopPreviewApi {
      tools: { list: () => Promise<Array<{ name: string; available: boolean }>> };
      quickDownload: {
        previewFrame: (input: { url: string; timestampSeconds: number }) => Promise<{ dataUrl: string }>;
      };
    }

    let toolsReady = false;
    const readyDeadline = Date.now() + 30_000;
    while (Date.now() < readyDeadline) {
      const list = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopPreviewApi }).desktop.tools.list()
      );
      const ready = list.find((item) => item.name === 'yt-dlp')?.available && list.find((item) => item.name === 'ffmpeg')?.available;
      if (ready) {
        toolsReady = true;
        break;
      }
      await sleep(300);
    }
    expect(toolsReady, 'yt-dlp/ffmpeg phải sẵn sàng trong 30s').toBe(true);

    const result = await shellWindow.evaluate(
      (url) => (window as unknown as { desktop: DesktopPreviewApi }).desktop.quickDownload.previewFrame({ url, timestampSeconds: 2 }),
      clipUrl
    );
    expect(result.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    const bytes = Buffer.from(result.dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes[0]).toBe(0xff); // magic bytes JPEG
    expect(bytes[1]).toBe(0xd8);

    const leftover = fs.readdirSync(tmpdir()).filter((name) => name.startsWith('tubmedia-preview-'));
    expect(leftover, 'không được để lại thư mục tạm nào sau khi trích khung hình xong').toEqual([]);
  } finally {
    server?.close();
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Sửa lỗi 2026-09-23 — tải xong 1 video qua Tải nhanh không làm đơ ứng dụng; icon "đang tải" xoay đúng', async () => {
  // Vấn đề 2 (nghiêm trọng): sau khi tải xong, toàn bộ ứng dụng đứng im — nghi do bước ghi credit mới
  // (Giai đoạn 6 mục 1) chặn trước khi báo "hoàn tất". Vấn đề 1: icon "Đang tải" không xoay.
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy yt-dlp/ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-quickdownload-freeze-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ytdlpPath: path.join(toolsDirectory!, 'yt-dlp.exe'),
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  const clipDirectory = path.join(sandbox, 'nguon-that');
  fs.mkdirSync(clipDirectory, { recursive: true });
  const clipPath = path.join(clipDirectory, 'clip.mp4');
  const ffmpegResult = spawnSync(
    path.join(toolsDirectory!, 'ffmpeg.exe'),
    [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=960x540:rate=24:duration=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15',
      '-c:v', 'libx264', '-preset', 'veryslow', '-c:a', 'aac', clipPath
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 90_000 }
  );
  expect(ffmpegResult.status, 'ffmpeg phải dựng được clip thử').toBe(0);
  const clipData = fs.readFileSync(clipPath);

  let server: Server | undefined;
  try {
    // Phát chậm có chủ ý để lượt tải THẬT ở trạng thái "downloading" đủ lâu quan sát icon xoay và thử
    // thao tác UI ngay trong lúc đang tải/đang xử lý — không chỉ sau khi mọi thứ đã xong.
    const CHUNK = 16 * 1024;
    server = createServer(async (request, response) => {
      const range = request.headers.range;
      const start = range ? Number(/bytes=(\d*)-/.exec(range)?.[1] ?? 0) : 0;
      const end = clipData.length - 1;
      response.writeHead(range ? 206 : 200, {
        'Content-Type': 'video/mp4',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clipData.length}` } : {}),
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes'
      });
      for (let offset = start; offset <= end; offset += CHUNK) {
        response.write(clipData.subarray(offset, Math.min(offset + CHUNK, end + 1)));
        await sleep(100);
      }
      response.end();
    });
    const port = await new Promise<number>((resolvePort) => {
      server!.listen(0, '127.0.0.1', () => resolvePort((server!.address() as { port: number }).port));
    });
    const clipUrl = `http://127.0.0.1:${port}/clip.mp4`;

    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    const consoleErrors: string[] = [];
    shellWindow.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    shellWindow.on('pageerror', (err) => pageErrors.push(err.message));

    interface DesktopQuickDownloadApi {
      tools: { list: () => Promise<Array<{ name: string; available: boolean }>> };
      quickDownload: { current: () => Promise<{ phase: string; message: string; progress: number } | null> };
    }

    let toolsReady = false;
    const readyDeadline = Date.now() + 30_000;
    while (Date.now() < readyDeadline) {
      const list = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopQuickDownloadApi }).desktop.tools.list()
      );
      const ready = list.find((item) => item.name === 'yt-dlp')?.available && list.find((item) => item.name === 'ffmpeg')?.available;
      if (ready) {
        toolsReady = true;
        break;
      }
      await sleep(300);
    }
    expect(toolsReady, 'yt-dlp/ffmpeg phải sẵn sàng trong 30s').toBe(true);

    await shellWindow.click('text=Tải 1 video');
    await shellWindow.waitForSelector('.quick-download-folder-input', { timeout: 10_000 });
    await shellWindow.fill('input[placeholder*="youtube.com"]', clipUrl);
    await shellWindow.click('button:has-text("Tải toàn bộ video")');

    let sawSpinningWhileDownloading = false;
    let midFlightClickOk = false;
    let finalPhase = '';
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const current = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopQuickDownloadApi }).desktop.quickDownload.current()
      );
      if (current?.phase === 'downloading' && !sawSpinningWhileDownloading) {
        const svgClass = await shellWindow.evaluate(() => {
          const el = document.querySelector('[data-status="downloading"]');
          const svg = el?.querySelector('svg');
          return svg ? svg.getAttribute('class') : null;
        });
        sawSpinningWhileDownloading = Boolean(svgClass?.includes('animate-spin'));
      }
      if (current && ['processing', 'verifying'].includes(current.phase) && !midFlightClickOk) {
        await shellWindow.click('text=Hàng đợi', { timeout: 6000 });
        midFlightClickOk = await shellWindow.evaluate(() => document.body.innerText.includes('Hàng đợi'));
        await shellWindow.click('text=Tải 1 video', { timeout: 6000 });
      }
      if (current && ['completed', 'failed', 'cancelled'].includes(current.phase)) {
        finalPhase = current.phase;
        break;
      }
      await sleep(200);
    }

    expect(finalPhase, 'lượt tải phải kết thúc trong 90s, không được treo vô thời hạn').toBe('completed');
    expect(sawSpinningWhileDownloading, 'icon huy hiệu "downloading" phải có lớp animate-spin').toBe(true);
    expect(midFlightClickOk, 'phải bấm chuyển trang được NGAY TRONG LÚC đang xử lý/xác minh, không bị khóa').toBe(true);

    // Đúng trọng tâm Vấn đề 2: UI phải phản hồi được NGAY sau khi báo "hoàn tất", không phải chờ thêm.
    // Dùng đúng vai trò trong đúng vùng điều hướng thay vì selector chữ mơ hồ "text=Cài đặt" (Sự cố phát
    // hành 1.5.0, 2026-09-26) — KHÔNG đổi mốc thời gian đo lường bên dưới, chỉ sửa cách chọn phần tử.
    const afterCompleteClickStart = Date.now();
    await shellWindow
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('button', { name: 'Cài đặt', exact: true })
      .click({ timeout: 8_000 });
    const settledText = await shellWindow.evaluate(() => document.body.innerText.includes('Cài đặt'));
    expect(settledText).toBe(true);
    expect(Date.now() - afterCompleteClickStart, 'ứng dụng phải phản hồi gần như ngay sau khi hoàn tất').toBeLessThan(8_000);

    expect(consoleErrors, 'không được có lỗi console nào (ví dụ vòng lặp render vô hạn)').toEqual([]);
    expect(pageErrors, 'không được có exception nào không bắt được').toEqual([]);
  } finally {
    server?.close();
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Giai đoạn 6 mục 2: cắt tệp có sẵn trên máy (không qua tải) — xem trước, cắt nhanh, cắt chính xác, hủy giữa chừng', async () => {
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-local-cut-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const outputDirectory = path.join(sandbox, 'ra');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  const sourceFile = path.join(sandbox, 'video-nguon.mp4');
  const ffmpegResult = spawnSync(
    path.join(toolsDirectory!, 'ffmpeg.exe'),
    [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', sourceFile
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  expect(ffmpegResult.status, 'ffmpeg phải dựng được video nguồn thử').toBe(0);

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    interface DesktopLocalCutApi {
      tools: { list: () => Promise<Array<{ name: string; available: boolean }>> };
      localCut: {
        previewFrame: (input: { filePath: string; timestampSeconds: number }) => Promise<{ dataUrl: string }>;
        start: (input: {
          filePath: string;
          outputDirectory: string;
          startTime: string;
          endTime: string;
          accurateCut: boolean;
        }) => Promise<{ taskId: string }>;
        status: (taskId: string) => Promise<{
          phase: string;
          outputPath: string | null;
          actualDurationSeconds: number | null;
        } | null>;
        cancel: (taskId: string) => Promise<unknown>;
      };
    }

    let toolsReady = false;
    const readyDeadline = Date.now() + 30_000;
    while (Date.now() < readyDeadline) {
      const list = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.tools.list()
      );
      if (list.find((item) => item.name === 'ffmpeg')?.available) {
        toolsReady = true;
        break;
      }
      await sleep(300);
    }
    expect(toolsReady, 'ffmpeg phải sẵn sàng trong 30s').toBe(true);

    await shellWindow.click('text=Xem trước & Cắt');
    await shellWindow.waitForSelector('text=Cắt tệp có sẵn trên máy', { timeout: 10_000 });

    const [startFrame, endFrame] = await Promise.all([
      shellWindow.evaluate(
        (args) => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.localCut.previewFrame(args),
        { filePath: sourceFile, timestampSeconds: 2 }
      ),
      shellWindow.evaluate(
        (args) => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.localCut.previewFrame(args),
        { filePath: sourceFile, timestampSeconds: 8 }
      )
    ]);
    expect(startFrame.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(endFrame.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(startFrame.dataUrl).not.toBe(endFrame.dataUrl);

    async function runToEnd(request: {
      filePath: string;
      outputDirectory: string;
      startTime: string;
      endTime: string;
      accurateCut: boolean;
    }) {
      const started = await shellWindow!.evaluate(
        (args) => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.localCut.start(args),
        request
      );
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const current = await shellWindow!.evaluate(
          (taskId) => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.localCut.status(taskId),
          started.taskId
        );
        if (current && ['completed', 'failed', 'cancelled'].includes(current.phase)) return current;
        await sleep(200);
      }
      throw new Error('Quá thời gian chờ lượt cắt kết thúc.');
    }

    const fastCut = await runToEnd({
      filePath: sourceFile,
      outputDirectory,
      startTime: '00:00:02',
      endTime: '00:00:08',
      accurateCut: false
    });
    expect(fastCut.phase, 'cắt nhanh phải hoàn tất').toBe('completed');
    expect(fastCut.outputPath && fs.existsSync(fastCut.outputPath), 'tệp cắt nhanh phải tồn tại thật').toBe(true);
    expect(fs.existsSync(sourceFile), 'tệp nguồn không được bị đụng tới').toBe(true);

    const accurateCutResult = await runToEnd({
      filePath: sourceFile,
      outputDirectory,
      startTime: '00:00:02',
      endTime: '00:00:08',
      accurateCut: true
    });
    expect(accurateCutResult.phase, 'cắt chính xác phải hoàn tất').toBe('completed');
    expect(
      accurateCutResult.outputPath && fs.existsSync(accurateCutResult.outputPath),
      'tệp cắt chính xác phải tồn tại thật'
    ).toBe(true);
    expect(
      Math.abs((accurateCutResult.actualDurationSeconds ?? 0) - 6),
      'thời lượng thật phải xấp xỉ đúng 6 giây yêu cầu'
    ).toBeLessThanOrEqual(1);

    // Hủy giữa chừng: xác nhận đúng phase 'cancelled' (KHÔNG bị báo nhầm 'failed' — lỗi thật đã tìm và
    // sửa ngày 2026-09-24: ProcessManager.run() ném lỗi khi bị hủy thay vì trả về {code,...}).
    const cancelStarted = await shellWindow.evaluate(
      (args) => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.localCut.start(args),
      { filePath: sourceFile, outputDirectory, startTime: '00:00:00', endTime: '00:00:14', accurateCut: true }
    );
    await sleep(150);
    await shellWindow.evaluate(
      (taskId) => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.localCut.cancel(taskId),
      cancelStarted.taskId
    );
    let cancelledStatus: Awaited<ReturnType<DesktopLocalCutApi['localCut']['status']>> = null;
    const cancelDeadline = Date.now() + 30_000;
    while (Date.now() < cancelDeadline) {
      cancelledStatus = await shellWindow.evaluate(
        (taskId) => (window as unknown as { desktop: DesktopLocalCutApi }).desktop.localCut.status(taskId),
        cancelStarted.taskId
      );
      if (cancelledStatus && ['completed', 'failed', 'cancelled'].includes(cancelledStatus.phase)) break;
      await sleep(200);
    }
    expect(cancelledStatus?.phase, 'hủy giữa chừng phải báo đúng "cancelled", không phải "failed"').toBe('cancelled');
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Giai đoạn 6 mục 3: đổi tỉ lệ khung hình khi cắt tệp có sẵn (9:16/1:1/16:9, nền mờ kiểu CapCut)', async () => {
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-local-cut-aspect-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const outputDirectory = path.join(sandbox, 'ra');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  // Nguồn 16:9 (640x360) — chuyển sang 9:16 dọc phải phóng to+mờ làm nền, không được méo/cắt mất video gốc.
  const sourceFile = path.join(sandbox, 'video-nguon.mp4');
  const ffmpegResult = spawnSync(
    path.join(toolsDirectory!, 'ffmpeg.exe'),
    [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', sourceFile
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  expect(ffmpegResult.status, 'ffmpeg phải dựng được video nguồn thử').toBe(0);

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    interface DesktopLocalCutAspectApi {
      tools: { list: () => Promise<Array<{ name: string; available: boolean }>> };
      localCut: {
        previewFrame: (input: {
          filePath: string;
          timestampSeconds: number;
          aspectRatio?: string;
        }) => Promise<{ dataUrl: string }>;
        start: (input: {
          filePath: string;
          outputDirectory: string;
          startTime: string;
          endTime: string;
          accurateCut: boolean;
          aspectRatio?: string;
        }) => Promise<{ taskId: string }>;
        status: (taskId: string) => Promise<{
          phase: string;
          outputPath: string | null;
          aspectRatio: string;
        } | null>;
      };
    }

    let toolsReady = false;
    const readyDeadline = Date.now() + 30_000;
    while (Date.now() < readyDeadline) {
      const list = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopLocalCutAspectApi }).desktop.tools.list()
      );
      if (list.find((item) => item.name === 'ffmpeg')?.available) {
        toolsReady = true;
        break;
      }
      await sleep(300);
    }
    expect(toolsReady, 'ffmpeg phải sẵn sàng trong 30s').toBe(true);

    // Xem khung hình với aspectRatio khác original phải phản ánh đúng kết quả sau xử lý (nền mờ + giữa).
    const previewed = await shellWindow.evaluate(
      (args) => (window as unknown as { desktop: DesktopLocalCutAspectApi }).desktop.localCut.previewFrame(args),
      { filePath: sourceFile, timestampSeconds: 3, aspectRatio: '9:16' }
    );
    expect(previewed.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);

    async function runToEnd(request: {
      filePath: string;
      outputDirectory: string;
      startTime: string;
      endTime: string;
      accurateCut: boolean;
      aspectRatio?: string;
    }) {
      const started = await shellWindow!.evaluate(
        (args) => (window as unknown as { desktop: DesktopLocalCutAspectApi }).desktop.localCut.start(args),
        request
      );
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const current = await shellWindow!.evaluate(
          (taskId) => (window as unknown as { desktop: DesktopLocalCutAspectApi }).desktop.localCut.status(taskId),
          started.taskId
        );
        if (current && ['completed', 'failed', 'cancelled'].includes(current.phase)) return current;
        await sleep(200);
      }
      throw new Error('Quá thời gian chờ lượt cắt kết thúc.');
    }

    const verticalCut = await runToEnd({
      filePath: sourceFile,
      outputDirectory,
      startTime: '00:00:01',
      endTime: '00:00:05',
      accurateCut: false, // KHÔNG chọn "cắt chính xác" — vẫn phải bị buộc mã hóa lại vì đổi tỉ lệ.
      aspectRatio: '9:16'
    });
    expect(verticalCut.phase, 'cắt kèm đổi tỉ lệ 9:16 phải hoàn tất').toBe('completed');
    expect(verticalCut.aspectRatio).toBe('9:16');
    expect(
      verticalCut.outputPath && fs.existsSync(verticalCut.outputPath),
      'tệp đã đổi tỉ lệ phải tồn tại thật'
    ).toBe(true);
    expect(verticalCut.outputPath, 'tên tệp phải có hậu tố tỉ lệ').toMatch(/\[9x16\]/);

    // Xác nhận THẬT bằng ffprobe: kích thước đầu ra đúng 1080x1920 (chuẩn xuất Reels/Shorts).
    const probeOutput = execFileSync(
      path.join(toolsDirectory!, 'ffprobe.exe'),
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', verticalCut.outputPath!],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    expect(probeOutput, 'kích thước thật của tệp xuất ra phải đúng 1080x1920').toBe('1080,1920');

    const squareCut = await runToEnd({
      filePath: sourceFile,
      outputDirectory,
      startTime: '00:00:01',
      endTime: '00:00:04',
      accurateCut: true,
      aspectRatio: '1:1'
    });
    expect(squareCut.phase, 'cắt kèm đổi tỉ lệ 1:1 phải hoàn tất').toBe('completed');
    const squareProbe = execFileSync(
      path.join(toolsDirectory!, 'ffprobe.exe'),
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', squareCut.outputPath!],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    expect(squareProbe, 'kích thước thật của tệp xuất ra phải đúng 1080x1080').toBe('1080,1080');

    const originalCut = await runToEnd({
      filePath: sourceFile,
      outputDirectory,
      startTime: '00:00:01',
      endTime: '00:00:04',
      accurateCut: false
      // Không gửi aspectRatio: phải mặc định 'original' — tương thích ngược với mục 2 (sao chép nhanh vẫn hoạt động).
    });
    expect(originalCut.phase, "cắt với aspectRatio mặc định 'original' vẫn phải hoạt động như mục 2").toBe('completed');
    expect(originalCut.aspectRatio).toBe('original');
    expect(originalCut.outputPath, 'không có hậu tố tỉ lệ khi giữ nguyên').not.toMatch(/\[\d+x\d+\]/);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Giai đoạn 6 mục 6: xem thông tin tệp — media:analyze trả đúng thông số thật của tệp cục bộ bất kỳ', async () => {
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-media-analyze-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  // Thông số ĐÃ BIẾT trước, dựng bằng ffmpeg thật — dùng để đối chiếu với kết quả media:analyze thật.
  const sourceFile = path.join(sandbox, 'video-thong-tin.mp4');
  const ffmpegResult = spawnSync(
    path.join(toolsDirectory!, 'ffmpeg.exe'),
    [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=960x540:rate=24:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '128k', sourceFile
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  expect(ffmpegResult.status, 'ffmpeg phải dựng được video thử với thông số đã biết trước').toBe(0);
  const realFileSize = fs.statSync(sourceFile).size;

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    interface DesktopMediaApi {
      tools: { list: () => Promise<Array<{ name: string; available: boolean }>> };
      media: {
        analyze: (path: string) => Promise<{
          width: number;
          height: number;
          fps: number;
          duration: number;
          videoCodec: string;
          audioCodec: string | null;
          fileSize: number;
        }>;
      };
    }

    // media:analyze dùng ffprobe (không phải ffmpeg) — phải đợi đúng công cụ cần dùng sẵn sàng.
    let toolsReady = false;
    const readyDeadline = Date.now() + 30_000;
    while (Date.now() < readyDeadline) {
      const list = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopMediaApi }).desktop.tools.list()
      );
      if (list.find((item) => item.name === 'ffprobe')?.available) {
        toolsReady = true;
        break;
      }
      await sleep(300);
    }
    expect(toolsReady, 'ffprobe phải sẵn sàng trong 30s').toBe(true);

    const info = await shellWindow.evaluate(
      (filePath) => (window as unknown as { desktop: DesktopMediaApi }).desktop.media.analyze(filePath),
      sourceFile
    );
    expect(info.width, 'chiều rộng thật phải khớp đúng thông số đã dựng').toBe(960);
    expect(info.height, 'chiều cao thật phải khớp đúng thông số đã dựng').toBe(540);
    expect(info.fps, 'khung hình/giây thật phải khớp đúng thông số đã dựng').toBe(24);
    expect(Math.abs(info.duration - 6), 'thời lượng thật phải xấp xỉ đúng 6 giây').toBeLessThanOrEqual(0.5);
    expect(info.videoCodec, 'codec hình thật phải là h264').toBe('h264');
    expect(info.audioCodec, 'codec âm thanh thật phải là aac').toBe('aac');
    expect(info.fileSize, 'dung lượng tệp thật phải khớp đúng fs.stat thật trên đĩa').toBe(realFileSize);

    // Tệp không tồn tại: phải báo lỗi rõ ràng bằng tiếng Việt, không để lộ lỗi ffprobe thô.
    await expect(
      shellWindow.evaluate(
        (filePath) => (window as unknown as { desktop: DesktopMediaApi }).desktop.media.analyze(filePath),
        path.join(sandbox, 'khong-ton-tai.mp4')
      )
    ).rejects.toThrow(/không tìm thấy tệp/i);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Giai đoạn 6 mục 7: mẫu đặt tên tệp Tải nhanh — lưu/đọc thật qua Cài đặt, từ chối mẫu có ký tự nguy hiểm', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-filename-template-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    interface DesktopSettingsApi {
      settings: {
        get: () => Promise<{ quickDownloadFilenameTemplate: string }>;
        update: (patch: Record<string, unknown>) => Promise<{ quickDownloadFilenameTemplate: string }>;
      };
    }

    const before = await shellWindow.evaluate(
      () => (window as unknown as { desktop: DesktopSettingsApi }).desktop.settings.get()
    );
    expect(before.quickDownloadFilenameTemplate, 'mặc định phải khớp đúng hành vi tên tệp cũ').toBe(
      '{title} [{id}]'
    );

    const updated = await shellWindow.evaluate(
      () =>
        (window as unknown as { desktop: DesktopSettingsApi }).desktop.settings.update({
          quickDownloadFilenameTemplate: '{channel} - {title} ({date})'
        })
    );
    expect(updated.quickDownloadFilenameTemplate).toBe('{channel} - {title} ({date})');

    const reread = await shellWindow.evaluate(
      () => (window as unknown as { desktop: DesktopSettingsApi }).desktop.settings.get()
    );
    expect(reread.quickDownloadFilenameTemplate, 'phải đọc lại đúng giá trị đã lưu thật vào CSDL').toBe(
      '{channel} - {title} ({date})'
    );

    // Mẫu chứa '%' phải bị từ chối thật ở tầng IPC (không chỉ ở bài kiểm đơn vị) — chặn chèn cú pháp
    // trường yt-dlp ngoài 4 token đã định nghĩa.
    await expect(
      shellWindow.evaluate(
        () =>
          (window as unknown as { desktop: DesktopSettingsApi }).desktop.settings.update({
            quickDownloadFilenameTemplate: '%(filepath)s'
          })
      )
    ).rejects.toThrow();

    // Giá trị cũ (hợp lệ) phải còn nguyên sau khi lượt cập nhật không hợp lệ bị từ chối.
    const afterRejected = await shellWindow.evaluate(
      () => (window as unknown as { desktop: DesktopSettingsApi }).desktop.settings.get()
    );
    expect(afterRejected.quickDownloadFilenameTemplate).toBe('{channel} - {title} ({date})');
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * B1 (2026-09-24) — yêu cầu mới, ƯU TIÊN CAO NHẤT: nếu máy tắt/app bị đóng đột ngột giữa lúc đang ghép một
 * quy trình, khi mở lại app phải TỰ ĐỘNG TIẾP TỤC đúng quy trình dang dở, không mất tiến độ, không phải
 * làm lại từ đầu, thành phẩm cuối cùng vẫn đúng. Cơ chế đã có sẵn từ trước (QueueManager.start() luôn gọi
 * repo.recoverInterrupted() rồi repo.resetInterrupted() — bất kỳ tác vụ nào còn ở trạng thái đang chạy dở
 * lúc khởi động lại đều bị đưa về 'pending' để hàng đợi tự chạy lại; MergeEngine có checkpoint
 * .pending.mp4 + .complete.json để không phải ghép lại từ đầu nếu checkpoint còn hợp lệ) — bài kiểm này
 * lần đầu xác nhận THẬT bằng 2 tiến trình Electron thật nối tiếp nhau: tiến trình thứ nhất bị taskkill
 * /T /F đột ngột đúng lúc đang ở trạng thái 'merging' (KHÔNG qua app.quit()/queue.stop() — mô phỏng đúng
 * mất điện/tắt máy đột ngột, không phải đóng ứng dụng bình thường), tiến trình thứ hai mở lại trỏ ĐÚNG
 * cùng thư mục dữ liệu (cùng CSDL SQLite, cùng thư mục tạm/checkpoint) và phải tự hoàn tất đúng.
 *
 * Cập nhật Đợt 1 mục 2 (2026-10-02): mở lại app KHÔNG còn tự chạy tác vụ dở. QueueManager.start() giữ tác vụ
 * ở 'paused' (APP_INTERRUPTED) và giao diện hỏi "Tiếp tục / Để sau"; bài kiểm bấm Tiếp tục rồi mới kiểm tra
 * việc tiếp tục đúng từ checkpoint. Hành vi tự chạy cũ chỉ còn khi bật cài đặt autoResumeInterruptedOnStartup.
 */
test('B1: ghép video tự động tiếp tục đúng sau khi app bị đóng đột ngột (kill thật giữa lúc đang ghép)', async () => {
  test.setTimeout(240_000);
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy yt-dlp/ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-merge-crash-resume-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ytdlpPath: path.join(toolsDirectory!, 'yt-dlp.exe'),
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  const clipDirectory = path.join(sandbox, 'nguon-that');
  fs.mkdirSync(clipDirectory, { recursive: true });
  const makeClip = (name: string, durationSeconds: number): string => {
    const clipPath = path.join(clipDirectory, name);
    const result = spawnSync(
      path.join(toolsDirectory!, 'ffmpeg.exe'),
      [
        '-y',
        '-f', 'lavfi', '-i', `testsrc=size=960x540:rate=24:duration=${durationSeconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSeconds}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', clipPath
      ],
      { stdio: 'ignore', windowsHide: true, timeout: 90_000 }
    );
    expect(result.status, `ffmpeg phải dựng được ${name}`).toBe(0);
    return clipPath;
  };
  const clip1Path = makeClip('clip1.mp4', 18);
  const clip2Path = makeClip('clip2.mp4', 18);
  const clip1Data = fs.readFileSync(clip1Path);
  const clip2Data = fs.readFileSync(clip2Path);

  let server: Server | undefined;
  try {
    server = createServer((request, response) => {
      const data = request.url === '/clip2.mp4' ? clip2Data : clip1Data;
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(data.length) });
      response.end(data);
    });
    const port = await new Promise<number>((resolvePort) => {
      server!.listen(0, '127.0.0.1', () => resolvePort((server!.address() as { port: number }).port));
    });
    const clip1Url = `http://127.0.0.1:${port}/clip1.mp4`;
    const clip2Url = `http://127.0.0.1:${port}/clip2.mp4`;

    const sourceFolder = path.join(sandbox, 'nguon');
    const tempFolder = path.join(sandbox, 'tam');
    const outputFolder = path.join(sandbox, 'ket-qua');
    for (const folder of [sourceFolder, tempFolder, outputFolder]) fs.mkdirSync(folder, { recursive: true });

    const launchEnv = (): Record<string, string> => ({
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      ),
      NODE_ENV: 'test',
      TUBMEDIA_E2E: '1',
      TUBMEDIA_E2E_USER_DATA: userDataDirectory,
      PLAYWRIGHT_TEST: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    });

    interface DesktopMergeCrashApi {
      tools: { list: () => Promise<Array<{ name: string; available: boolean }>> };
      workbench: { startMerge: (input: Record<string, unknown>) => Promise<unknown> };
      queue: {
        list: () => Promise<
          Array<{ id: string; type: string; status: string; progress: number; input: Record<string, unknown> }>
        >;
      };
    }

    // ---- Tiến trình Electron THẬT thứ nhất: bắt đầu ghép, giết đột ngột giữa lúc đang 'merging' ----
    const app1 = await electron.launch({ args: [mainEntry], cwd: projectRoot, env: launchEnv(), timeout: 45_000 });
    electronApplication = app1;
    mainProcessId = app1.process().pid;
    const win1 = await app1.firstWindow({ timeout: 30_000 });
    shellWindow = win1;
    await win1.waitForSelector('.app-sidebar', { timeout: 30_000 });

    let toolsReady = false;
    const toolsDeadline = Date.now() + 30_000;
    while (Date.now() < toolsDeadline) {
      const list = await win1.evaluate(
        () => (window as unknown as { desktop: DesktopMergeCrashApi }).desktop.tools.list()
      );
      if (
        list.find((item) => item.name === 'yt-dlp')?.available &&
        list.find((item) => item.name === 'ffmpeg')?.available
      ) {
        toolsReady = true;
        break;
      }
      await sleep(300);
    }
    expect(toolsReady, 'yt-dlp/ffmpeg phải sẵn sàng trong 30s').toBe(true);

    await win1.evaluate(
      (input) => (window as unknown as { desktop: DesktopMergeCrashApi }).desktop.workbench.startMerge(input),
      {
        slot: 'merge-1',
        name: 'Kiem tra tiep tuc ghep sau khi bi kill',
        linksText: `${clip1Url}\n${clip2Url}`,
        sourceFolder,
        tempFolder,
        outputFolder,
        finalFileName: 'Thanh-pham-kiem-tra-kill.mp4',
        // preset 'slow' cố ý để bước ghép thật có đủ thời gian quan sát trạng thái 'merging' trước khi bị
        // giết — không dùng preset nhanh nhất vì sẽ ghép xong quá nhanh để bắt kịp giữa chừng.
        qualityProfileId: 'quality-max-cpu',
        resourceProfileId: 'resource-balanced',
        exportTimelineTxt: false,
        timelineOnly: false,
        aspectRatio: 'original'
      }
    );

    let mergeJobId: string | null = null;
    let sawMerging = false;
    const mergingDeadline = Date.now() + 90_000;
    while (Date.now() < mergingDeadline) {
      const jobs = await win1.evaluate(
        () => (window as unknown as { desktop: DesktopMergeCrashApi }).desktop.queue.list()
      );
      const mergeJob = jobs.find((job) => job.type === 'merge');
      if (mergeJob) {
        mergeJobId = mergeJob.id;
        if (mergeJob.status === 'merging') {
          sawMerging = true;
          // Chờ tới khi tiến độ THẬT (không giả lập) đạt ngưỡng cao — đo thật xác nhận: ở ngưỡng này,
          // checkpoint ghép cuối (Tubmedia/merge-checkpoints/*.pending.mp4) đã được ghi xong, nên lượt
          // chạy lại sau khi giết phải TIẾP TỤC đúng từ checkpoint (verified-checkpoint) thay vì ghép lại
          // từ đầu — đúng trọng tâm "không mất tiến độ" mà yêu cầu B1 đòi hỏi.
          if (mergeJob.progress >= 70) break;
        } else if (['completed', 'failed', 'cancelled'].includes(mergeJob.status)) {
          break;
        }
      }
      await sleep(150);
    }
    expect(sawMerging, 'quy trình phải thật sự vào trạng thái đang ghép (merging) trước khi bị giết').toBe(true);
    expect(mergeJobId, 'phải xác định được đúng tác vụ ghép').not.toBeNull();

    const jobBeforeKill = (
      await win1.evaluate(() => (window as unknown as { desktop: DesktopMergeCrashApi }).desktop.queue.list())
    ).find((job) => job.id === mergeJobId);
    const statusBeforeKill = jobBeforeKill?.status;
    // Xác nhận THẬT (đọc trực tiếp thư mục tạm, không đoán): checkpoint ghép cuối đã tồn tại trên đĩa
    // trước khi bị giết — nếu không, ngưỡng tiến độ ở trên chưa đủ cao để bài kiểm này có ý nghĩa.
    const checkpointFolder = path.join(tempFolder, 'Tubmedia', 'merge-checkpoints');
    const hasMergeCheckpointBeforeKill =
      fs.existsSync(checkpointFolder) &&
      fs.readdirSync(checkpointFolder).some((name) => name.endsWith('.pending.mp4'));
    expect(
      hasMergeCheckpointBeforeKill,
      'checkpoint ghép cuối (Tubmedia/merge-checkpoints/*.pending.mp4) phải đã được ghi xong TRƯỚC khi giết ' +
        '— nếu không, bài kiểm chưa thật sự chạm tới đúng kịch bản "không mất tiến độ, không ghép lại từ đầu"'
    ).toBe(true);

    // ---- GIẾT ĐỘT NGỘT: taskkill /T /F toàn bộ cây tiến trình, KHÔNG gọi app.quit()/queue.stop() ----
    // Đây chính là điểm khác với đóng app bình thường: không có cơ hội chạy bất kỳ dọn dẹp an toàn nào
    // (queue.stop() — nơi đánh dấu 'interrupted' gọn gàng — sẽ KHÔNG được chạy).
    forceKillProcessTree(mainProcessId);
    electronApplication = undefined;
    shellWindow = undefined;
    mainProcessId = undefined;
    await sleep(500);

    // Xác nhận THẬT: ngay sau khi giết, CSDL vẫn còn kẹt ở trạng thái đang chạy dở — KHÔNG phải
    // 'interrupted' gọn gàng (trạng thái đó chỉ do queue.stop() ghi, và tiến trình đã chết trước khi kịp
    // chạy tới đó). Nếu giả này sai, bài kiểm chưa mô phỏng đúng kịch bản "tắt máy đột ngột".
    const dbAfterKill = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    const rowAfterKill = dbAfterKill.prepare('SELECT status FROM queue_jobs WHERE id = ?').get(mergeJobId) as
      | { status: string }
      | undefined;
    dbAfterKill.close();
    expect(
      statusBeforeKill === 'merging' && rowAfterKill?.status === 'merging',
      `CSDL phải còn kẹt ở 'merging' ngay sau khi giết đột ngột (trước kill: ${String(statusBeforeKill)}, ` +
        `sau kill: ${String(rowAfterKill?.status)}) — nếu không, bài kiểm này chưa mô phỏng đúng kịch bản ` +
        'tắt máy đột ngột.'
    ).toBe(true);

    // ---- Tiến trình Electron THẬT thứ hai: mở lại, TRỎ ĐÚNG cùng thư mục dữ liệu ----
    const app2 = await electron.launch({ args: [mainEntry], cwd: projectRoot, env: launchEnv(), timeout: 45_000 });
    electronApplication = app2;
    mainProcessId = app2.process().pid;
    const win2 = await app2.firstWindow({ timeout: 30_000 });
    shellWindow = win2;
    await win2.waitForSelector('.app-sidebar', { timeout: 30_000 });

    // Đợt 1 mục 2 (2026-10-02): mở lại app KHÔNG tự chạy tác vụ dở nữa — tác vụ ghép được giữ ở 'paused'
    // (APP_INTERRUPTED) và giao diện hỏi "Có N tác vụ chưa xong — Tiếp tục / Để sau". Bài kiểm B1 giữ
    // nguyên mục tiêu "tiếp tục đúng từ checkpoint, không mất tiến độ", chỉ thêm bước người dùng bấm Tiếp tục.
    const startupDialog = win2.getByRole('dialog', { name: /tác vụ chưa xong/ });
    await startupDialog.waitFor({ timeout: 30_000 });
    const heldBeforeResume = (
      await win2.evaluate(() => (window as unknown as { desktop: DesktopMergeCrashApi }).desktop.queue.list())
    ).find((job) => job.id === mergeJobId);
    expect(
      heldBeforeResume?.status,
      'trước khi người dùng chọn Tiếp tục, tác vụ ghép dở phải đang tạm dừng — không được tự chạy khi mở app'
    ).toBe('paused');
    await startupDialog.getByRole('button', { name: 'Tiếp tục' }).click();

    let finalStatus = '';
    let finalOutputPath = '';
    let finalRecoveryMode = '';
    const resumeStartedAt = Date.now();
    const resumeDeadline = resumeStartedAt + 150_000;
    while (Date.now() < resumeDeadline) {
      const jobs = await win2.evaluate(
        () => (window as unknown as { desktop: DesktopMergeCrashApi }).desktop.queue.list()
      );
      const mergeJob = jobs.find((job) => job.id === mergeJobId);
      if (mergeJob && ['completed', 'failed', 'cancelled'].includes(mergeJob.status)) {
        finalStatus = mergeJob.status;
        finalOutputPath = typeof mergeJob.input.outputPath === 'string' ? mergeJob.input.outputPath : '';
        finalRecoveryMode =
          typeof mergeJob.input.mergeRecoveryMode === 'string' ? mergeJob.input.mergeRecoveryMode : '(khong co)';
        break;
      }
      await sleep(300);
    }
    const resumeElapsedMs = Date.now() - resumeStartedAt;

    expect(
      finalStatus,
      'sau khi mở lại app, quy trình ghép dang dở PHẢI tự động tiếp tục và hoàn tất — không được kẹt mãi ở ' +
        'trạng thái cũ, không được biến mất, không được cần thao tác tay nào của người dùng'
    ).toBe('completed');
    // Đúng trọng tâm B1 — "không mất tiến độ, không phải làm lại từ đầu": vì checkpoint ghép cuối đã có
    // sẵn và hợp lệ trước khi bị giết (xác nhận ở trên), lượt chạy lại PHẢI dùng đúng nó
    // ('verified-checkpoint') thay vì ghép lại từ đầu ('new-merge') — đo thật xác nhận việc này chỉ mất
    // vài giây (bỏ qua toàn bộ bước chuẩn hóa + ghép nặng đã làm xong ở lượt trước).
    expect(
      finalRecoveryMode,
      `phải tiếp tục ĐÚNG từ checkpoint đã có (verified-checkpoint), không ghép lại từ đầu — thực tế: ` +
        `${finalRecoveryMode} (mất ${resumeElapsedMs}ms để hoàn tất sau khi mở lại)`
    ).toBe('verified-checkpoint');
    expect(
      Boolean(finalOutputPath) && fs.existsSync(finalOutputPath),
      'thành phẩm cuối cùng phải thật sự tồn tại trên đĩa'
    ).toBe(true);

    // Xác nhận THẬT bằng ffprobe: thành phẩm không hỏng, đọc được, thời lượng hợp lý (2 clip 18 giây ghép
    // lại — không thiếu đoạn do checkpoint hỏng, không lặp đoạn do ghép đè lên chính nó).
    const durationOutput = execFileSync(
      path.join(toolsDirectory!, 'ffprobe.exe'),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', finalOutputPath],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    const durationSeconds = Number(durationOutput);
    expect(Number.isFinite(durationSeconds), 'ffprobe phải đọc được thời lượng thật (tệp không hỏng)').toBe(true);
    expect(
      durationSeconds,
      'thời lượng thành phẩm phải khớp 2 clip 18 giây ghép lại (không thiếu/không lặp đoạn)'
    ).toBeGreaterThan(30);
    expect(durationSeconds).toBeLessThan(42);
  } finally {
    server?.close();
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * B2 (2026-09-24) — yêu cầu mới: video đã tải rồi không tải lại (cơ chế nhận diện theo source/link + media
 * ID đã có sẵn — xem media-source-repository.ts, sourceIdentity()/normalizeUrl() ở src/shared/utils/url.ts:
 * khóa nhận diện luôn dựng từ platform+extractorKey+mediaId (trích từ CHÍNH URL, không gọi API), hoặc hash
 * của URL đã chuẩn hóa nếu không trích được mediaId — KHÔNG BAO GIỜ dùng title). Yêu cầu kiểm thật trường
 * hợp cụ thể: hai video CÙNG TIÊU ĐỀ nhưng KHÁC LINK phải đều được tải đầy đủ, không bị bỏ qua nhầm vì
 * trùng tên. Dùng 2 URL cục bộ có CÙNG tên tệp cuối (".../movie.mp4") ở hai đường dẫn khác nhau — xác nhận
 * trước bằng yt-dlp thật rằng bộ trích xuất "generic" suy ra CÙNG tiêu đề "movie" cho cả hai (đúng kịch
 * bản người dùng mô tả), rồi tải thật cả hai qua "Tải danh sách".
 */
test('B2: hai video cùng tiêu đề khác link đều được tải đầy đủ, không bị bỏ qua nhầm vì trùng tên', async () => {
  test.setTimeout(150_000);
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy yt-dlp/ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-duplicate-title-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ytdlpPath: path.join(toolsDirectory!, 'yt-dlp.exe'),
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  // Hai clip THẬT khác nhau (kích thước khác nhau để phân biệt bằng ffprobe sau khi tải xong — chứng
  // minh không phải cùng một tệp/bị lấy nhầm của nhau).
  const clipDirectory = path.join(sandbox, 'nguon-that');
  fs.mkdirSync(clipDirectory, { recursive: true });
  const makeClip = (name: string, size: string): string => {
    const clipPath = path.join(clipDirectory, name);
    const result = spawnSync(
      path.join(toolsDirectory!, 'ffmpeg.exe'),
      ['-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=15:duration=3`, '-c:v', 'libx264', '-preset', 'ultrafast', clipPath],
      { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
    );
    expect(result.status, `ffmpeg phải dựng được ${name}`).toBe(0);
    return clipPath;
  };
  const clipAPath = makeClip('a.mp4', '480x270');
  const clipBPath = makeClip('b.mp4', '960x540');
  const clipAData = fs.readFileSync(clipAPath);
  const clipBData = fs.readFileSync(clipBPath);

  let server: Server | undefined;
  try {
    server = createServer((request, response) => {
      const data = request.url?.includes('/b/') ? clipBData : clipAData;
      const range = request.headers.range;
      const end = data.length - 1;
      if (range) {
        const start = Number(/bytes=(\d*)-/.exec(range)?.[1] ?? 0);
        response.writeHead(206, {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes'
        });
        response.end(data.subarray(start));
      } else {
        response.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': String(data.length),
          'Accept-Ranges': 'bytes'
        });
        response.end(data);
      }
    });
    const port = await new Promise<number>((resolvePort) => {
      server!.listen(0, '127.0.0.1', () => resolvePort((server!.address() as { port: number }).port));
    });
    // CÙNG tên tệp cuối ("movie.mp4") ở hai đường dẫn khác nhau — bộ trích xuất "generic" của yt-dlp suy
    // ra CÙNG tiêu đề "movie" cho cả hai (đã xác nhận thật bằng yt-dlp trước khi viết bài kiểm này).
    const urlA = `http://127.0.0.1:${port}/videos/a/movie.mp4`;
    const urlB = `http://127.0.0.1:${port}/videos/b/movie.mp4`;

    const outputFolder = path.join(sandbox, 'ket-qua');
    const tempFolder = path.join(sandbox, 'tam');
    for (const folder of [outputFolder, tempFolder]) fs.mkdirSync(folder, { recursive: true });

    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    interface DesktopDownloadDupApi {
      tools: { list: () => Promise<Array<{ name: string; available: boolean }>> };
      workbench: { startDownload: (input: Record<string, unknown>) => Promise<unknown> };
      queue: {
        list: () => Promise<
          Array<{ id: string; type: string; status: string; input: Record<string, unknown> }>
        >;
      };
    }

    let toolsReady = false;
    const toolsDeadline = Date.now() + 30_000;
    while (Date.now() < toolsDeadline) {
      const list = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopDownloadDupApi }).desktop.tools.list()
      );
      if (
        list.find((item) => item.name === 'yt-dlp')?.available &&
        list.find((item) => item.name === 'ffmpeg')?.available
      ) {
        toolsReady = true;
        break;
      }
      await sleep(300);
    }
    expect(toolsReady, 'yt-dlp/ffmpeg phải sẵn sàng trong 30s').toBe(true);

    await shellWindow.evaluate(
      (input) => (window as unknown as { desktop: DesktopDownloadDupApi }).desktop.workbench.startDownload(input),
      {
        slot: 'download-1',
        name: 'Kiem tra 2 video cung tieu de khac link',
        linksText: `${urlA}\n${urlB}`,
        outputFolder,
        tempFolder,
        resourceProfileId: 'resource-balanced'
      }
    );

    let downloadJobs: Array<{ id: string; type: string; status: string; input: Record<string, unknown> }> = [];
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const jobs = await shellWindow.evaluate(
        () => (window as unknown as { desktop: DesktopDownloadDupApi }).desktop.queue.list()
      );
      downloadJobs = jobs.filter((job) => job.type === 'download');
      if (downloadJobs.length >= 2 && downloadJobs.every((job) => ['completed', 'failed', 'cancelled'].includes(job.status))) {
        break;
      }
      await sleep(300);
    }

    expect(downloadJobs.length, 'phải tạo ĐÚNG 2 tác vụ tải riêng biệt — không bị gộp thành 1 vì trùng tên').toBe(2);
    for (const job of downloadJobs) {
      expect(job.status, `tác vụ tải ${job.id} phải hoàn tất, không được bị bỏ qua/thất bại`).toBe('completed');
    }
    // Xác nhận THẬT (đọc tên tệp thật trên đĩa, không đoán): cả hai tệp đúng là có cùng phần tiêu đề
    // "movie" do yt-dlp suy ra — nếu không, bài kiểm này chưa thật sự chạm đúng kịch bản "cùng tiêu đề".
    const downloadedNames = fs.readdirSync(outputFolder);
    expect(
      downloadedNames.filter((name) => name.startsWith('movie ')).length,
      `cả hai tệp phải có tiêu đề "movie" giống nhau (tên thật: ${downloadedNames.join(', ')})`
    ).toBe(2);

    const outputPaths = downloadJobs.map((job) =>
      typeof job.input.outputPath === 'string' ? job.input.outputPath : ''
    );
    expect(outputPaths.every((p) => p && fs.existsSync(p)), 'cả hai tệp đã tải phải thật sự tồn tại trên đĩa').toBe(
      true
    );
    expect(new Set(outputPaths).size, 'hai tệp đã tải phải là HAI tệp KHÁC NHAU, không được ghi đè lên nhau').toBe(
      2
    );

    // Xác nhận THẬT bằng ffprobe: hai tệp đúng là NỘI DUNG KHÁC NHAU (kích thước khác nhau như đã dựng),
    // không phải một tệp được tải rồi bị coi là "đã có" và dùng lại nhầm cho cả hai.
    const dimensionsOf = (filePath: string): string =>
      execFileSync(
        path.join(toolsDirectory!, 'ffprobe.exe'),
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath],
        { encoding: 'utf8', windowsHide: true }
      ).trim();
    const realDimensions = outputPaths.map(dimensionsOf).sort();
    expect(
      realDimensions,
      'hai video tải về phải có kích thước thật đúng như hai nguồn khác nhau (480x270 và 960x540)'
    ).toEqual(['480,270', '960,540']);
  } finally {
    server?.close();
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * A1 (2026-09-25) — yêu cầu mới đã được duyệt: tăng giới hạn quy trình song song từ 4 lên 6 cho cả "Tải
 * danh sách" và "Ghép theo Timeline" (maxGlobalMergeJobs — trần GHÉP ĐỒNG THỜI thật — cố tình giữ nguyên
 * 1-4 theo khuyến nghị phần cứng có sẵn của app, không đổi). Bài kiểm thật này xác nhận toàn bộ đường dây
 * đã đổi nhất quán: schema IPC thật (không chỉ type TypeScript) chấp nhận 5-6 và vẫn từ chối 7, và nút
 * "Thêm danh sách"/"Thêm quy trình" trên giao diện thật dừng đúng ở 6 (không đi tiếp lên 7).
 */
test('A1: giới hạn quy trình song song đã tăng đúng từ 4 lên 6 (IPC thật + nút bấm thật), không đổi trần ghép đồng thời', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-lane-limit-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.close();

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    interface DesktopSettingsUpdateApi {
      settings: { update: (patch: Record<string, unknown>) => Promise<Record<string, unknown>> };
    }
    const updateSetting = (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
      shellWindow!.evaluate(
        (p) => (window as unknown as { desktop: DesktopSettingsUpdateApi }).desktop.settings.update(p),
        patch
      );

    // ---- Xác nhận qua IPC thật: schema chấp nhận đúng 5 và 6, vẫn từ chối 7 ----
    for (const key of ['downloadLaneCount', 'mergeLaneCount']) {
      const at5 = await updateSetting({ [key]: 5 });
      expect(at5[key], `${key}=5 phải được chấp nhận thật qua IPC`).toBe(5);
      const at6 = await updateSetting({ [key]: 6 });
      expect(at6[key], `${key}=6 phải được chấp nhận thật qua IPC`).toBe(6);
      await expect(
        updateSetting({ [key]: 7 }),
        `${key}=7 phải bị từ chối thật qua IPC — giới hạn mới là 6, không phải bỏ giới hạn`
      ).rejects.toThrow();
    }

    // ---- Xác nhận maxGlobalMergeJobs KHÔNG bị đổi — vẫn đúng trần cũ 1-4 ----
    await expect(
      updateSetting({ maxGlobalMergeJobs: 5 }),
      'maxGlobalMergeJobs phải KHÔNG đổi theo A1 — vẫn từ chối giá trị ngoài 1-4 (trần ghép đồng thời thật, tách biệt khỏi số lane)'
    ).rejects.toThrow();
    const mergeJobsStill4 = await updateSetting({ maxGlobalMergeJobs: 4 });
    expect(mergeJobsStill4.maxGlobalMergeJobs, 'maxGlobalMergeJobs vẫn nhận tối đa 4 như cũ').toBe(4);

    // ---- Xác nhận qua nút bấm thật trên trang "Ghép theo Timeline": dừng đúng ở 6/6 ----
    await shellWindow.evaluate(() =>
      document.querySelector<HTMLElement>('[data-page-id="download-merge"]')?.click()
    );
    await shellWindow.waitForTimeout(400);
    const addMergeButton = shellWindow.getByRole('button', { name: 'Thêm quy trình' });
    for (let click = 0; click < 6; click += 1) {
      if (await addMergeButton.isEnabled().catch(() => false)) await addMergeButton.click();
      await shellWindow.waitForTimeout(200);
    }
    const mergeBadgeText = await shellWindow.evaluate(
      () => document.querySelector('.badge-strong')?.textContent ?? ''
    );
    expect(mergeBadgeText, 'thanh Ghép theo Timeline phải dừng đúng ở 6/6, không tiếp tục lên 7').toContain(
      '6/6'
    );
    expect(await addMergeButton.isDisabled(), 'nút "Thêm quy trình" phải bị khóa khi đã đạt đúng 6').toBe(true);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * A2 (2026-09-25) — 3 đề xuất tinh gọn giao diện đã được duyệt (mục 2 đã rút lại vì đọc code xác nhận
 * không phải lỗi thật): (1) bỏ thẻ "Bộ xử lý" trùng với thanh trên cùng ở trang Chẩn đoán; (3) ẩn nút
 * "Tiếp tục tất cả"/"Tạm dừng tất cả" ở thanh trên cùng khi đang đứng ngay tại trang Hàng đợi (đã xác
 * nhận qua code: 2 nút gọi ĐÚNG CÙNG lệnh queue.resumeAll()/pauseAll()); (4) dòng gợi ý "Tải 1 video"
 * làm rõ quan hệ với "Tải danh sách". Bài kiểm thật này xác nhận cả 3 trên giao diện thật, không chỉ đọc
 * code — không cần yt-dlp/ffmpeg vì chỉ kiểm tra bố cục/nút bấm, không tải/ghép gì.
 */
test('A2: 3 đề xuất tinh gọn giao diện đã duyệt hoạt động đúng trên giao diện thật', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-a2-declutter-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.close();

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    // ---- Mục 4: dòng gợi ý "Tải 1 video" đã làm rõ quan hệ với "Tải danh sách" ----
    const stepDownloadTitle = await shellWindow.evaluate(
      () => document.querySelector<HTMLElement>('[data-page-id="step-download"]')?.title ?? ''
    );
    expect(stepDownloadTitle, 'gợi ý ở mục "Tải 1 video" phải nhắc tới "Tải danh sách"').toContain(
      'Tải danh sách'
    );

    // ---- Mục 3: nút "Tiếp tục tất cả"/"Tạm dừng tất cả" ở thanh trên cùng VẪN hiện ở trang KHÁC ----
    // Sự cố phát hành 1.5.0 (2026-09-26): thay waitForTimeout(300) cố định bằng chờ ĐÚNG điều kiện thật
    // (expect(...).toHaveCount tự lặp lại tới khi đúng hoặc hết thời gian) — trang đích ở đây là
    // lazy()-load, 300ms có thể không đủ trên máy CI chậm/đang bận tự kết nối công cụ ở nền (cùng nguyên
    // nhân gốc với Sự cố 3 ở bài kiểm chọn hồ sơ Chrome).
    await shellWindow.evaluate(() =>
      document.querySelector<HTMLElement>('[data-page-id="download-workbench"]')?.click()
    );
    await expect(
      shellWindow.locator('.topbar-pause'),
      'nút Tiếp tục/Tạm dừng tất cả ở thanh trên cùng phải VẪN hiện ở trang khác Hàng đợi'
    ).toHaveCount(1, { timeout: 10_000 });

    // ---- Mục 3: nút đó BỊ ẨN khi đang đứng ngay ở trang Hàng đợi (chỉ còn bản riêng của trang) ----
    await shellWindow.evaluate(() => document.querySelector<HTMLElement>('[data-page-id="activity"]')?.click());
    await expect(
      shellWindow.locator('.topbar-pause'),
      'nút Tiếp tục/Tạm dừng tất cả ở thanh trên cùng phải BỊ ẨN khi đang ở đúng trang Hàng đợi'
    ).toHaveCount(0, { timeout: 10_000 });
    // Bản thân trang Hàng đợi (lazy()-load) có thể chưa mount xong ngay khi thanh trên cùng đã cập nhật
    // xong (2 việc độc lập) — chờ lặp lại (expect.poll) thay vì đọc một lần duy nhất.
    await expect
      .poll(
        () =>
          shellWindow!.evaluate(() =>
            Array.from(document.querySelectorAll('button')).some(
              (button) =>
                button.textContent?.includes('Tiếp tục tất cả') || button.textContent?.includes('Tạm dừng tất cả')
            )
          ),
        { timeout: 10_000, message: 'trang Hàng đợi phải vẫn còn đúng 1 nút riêng của nó' }
      )
      .toBe(true);

    // ---- Mục 1: trang Chẩn đoán không còn thẻ "Bộ xử lý" trùng với thanh trên cùng ----
    await shellWindow.evaluate(() => document.querySelector<HTMLElement>('[data-page-id="diagnostics"]')?.click());
    await expect(
      shellWindow.locator('.diagnostics-summary > *'),
      'trang Chẩn đoán chỉ còn đúng 3 thẻ (bỏ thẻ CPU trùng lặp)'
    ).toHaveCount(3, { timeout: 10_000 });
    const diagnosticsSummaryText = await shellWindow.evaluate(
      () => document.querySelector('.diagnostics-summary')?.textContent ?? ''
    );
    expect(diagnosticsSummaryText, 'thẻ "Bộ xử lý" phải không còn ở trang Chẩn đoán').not.toContain('Bộ xử lý');
    // Thanh trên cùng vẫn còn đúng số CPU thật (không bị đụng tới, chỉ bỏ bản trùng ở trang).
    expect(
      await shellWindow.locator('text=BỘ XỬ LÝ').count(),
      'thanh trên cùng vẫn phải còn hiện số CPU như trước'
    ).toBeGreaterThan(0);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Sự cố sau phát hành v1.4.0 (2026-09-25): khi phát hiện bản cập nhật mới, người dùng chỉ thấy trạng thái
 * đổi ở trang "Cập nhật" — phải TỰ vào đúng trang đó mới biết. Điều tra: thông báo nổi VẪN CÓ (không phải
 * hoàn toàn không có), nhưng dùng đúng mức "info"/"success" nên tự tắt theo notification-policy.ts
 * (TRANSIENT_NOTIFICATION_DURATION_MS=4.8s / SUCCESS_NOTIFICATION_DURATION_MS=3.6s) và KHÔNG có nút hành
 * động nào — chỉ là dòng chữ thoáng qua. Đã sửa: giữ nguyên màu info/success (không đổi thành warning),
 * nhưng kéo dài thời gian hiện lên tối thiểu 12 giây (dùng chung ACTION_REQUIRED_WARNING_MIN_DURATION_MS
 * đã có sẵn cho "cảnh báo cần hành động" ở Vấn đề 1 — chặn cookies) và thêm nút "Cập nhật ngay" đi thẳng
 * tới trang Cập nhật. Bài kiểm thật này dùng hook TUBMEDIA_E2E_FAKE_UPDATE_STATUS_JSON (chỉ có tác dụng
 * khi đặt tường minh, không tồn tại trong bản phát hành thật) để mô phỏng ĐÚNG sự kiện main process vừa
 * phát hiện bản cập nhật mới qua kênh IPC thật (window.desktop.events.onUpdateStatus) — không đụng tới
 * AppUpdateService/electron-updater/mạng thật.
 */
test('Sửa lỗi sau phát hành 2026-09-25: phát hiện bản cập nhật hiện thông báo rõ ràng, không tự tắt quá nhanh, có nút "Cập nhật ngay"', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-update-notice-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.close();

  const fakeUpdateStatus = {
    state: 'available',
    currentVersion: '1.0.0',
    channel: 'stable',
    supported: true,
    checkedAt: new Date().toISOString(),
    message: null,
    info: { version: '99.9.9', releaseDate: null, releaseName: null, releaseNotes: null },
    progress: null,
    error: null
  };

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        TUBMEDIA_E2E_FAKE_UPDATE_STATUS_JSON: JSON.stringify(fakeUpdateStatus),
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });

    const attention = shellWindow.locator('.attention-center');
    await expect(attention, 'thông báo phát hiện cập nhật phải hiện ra').toBeVisible({ timeout: 10_000 });
    await expect(attention).toContainText('99.9.9');

    const actionButton = attention.getByRole('button', { name: 'Cập nhật ngay' });
    await expect(actionButton, 'phải có nút hành động ngay trên thông báo').toBeVisible();

    // Đúng trọng tâm lỗi: KHÔNG được tự tắt trong vài giây đầu (trước đây chỉ 4,8s cho mức "info").
    // Chờ THẬT 6 giây (không giả lập đồng hồ) rồi xác nhận thông báo vẫn còn — vượt quá mốc cũ.
    await shellWindow.waitForTimeout(6_000);
    await expect(attention, 'thông báo không được tự tắt trước ít nhất 12 giây (cảnh báo cần hành động)').toBeVisible();

    // Bấm nút phải dẫn thẳng tới trang Cập nhật, không cần người dùng tự tìm.
    await actionButton.click();
    await shellWindow.waitForTimeout(400);
    const onUpdatesPage = await shellWindow.evaluate(() =>
      document.body.innerText.includes('Trung tâm cập nhật')
    );
    expect(onUpdatesPage, 'bấm nút phải đi thẳng tới trang Cập nhật').toBe(true);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Sự cố 2026-09-25: máy có nhiều hồ sơ Chrome (đã xác nhận thật trên máy người dùng có 6 hồ sơ, mỗi hồ
 * sơ một tài khoản Google khác nhau) thì để trống ô "Hồ sơ trình duyệt" khiến yt-dlp tự chọn hồ sơ "dùng
 * gần nhất trong Chrome" — người dùng không kiểm soát được và không biết đang lấy cookies của ai. Bài
 * kiểm này giả lập ĐÚNG cấu trúc Local State thật (đã đối chiếu với dữ liệu thật) qua LOCALAPPDATA riêng
 * cho tiến trình Electron của bài kiểm — không phụ thuộc Chrome thật cài trên máy chạy CI, nhưng vẫn đi
 * qua đúng code đọc file thật (không mock hàm main process).
 */
test('Sự cố 2026-09-25: chọn đúng hồ sơ Chrome thật khi lấy cookies tự động, không lấy nhầm tài khoản', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-chrome-profiles-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });

  const fakeLocalAppData = path.join(sandbox, 'localappdata');
  const chromeUserData = path.join(fakeLocalAppData, 'Google', 'Chrome', 'User Data');
  fs.mkdirSync(chromeUserData, { recursive: true });
  fs.writeFileSync(
    path.join(chromeUserData, 'Local State'),
    JSON.stringify({
      profile: {
        last_used: 'Profile 1',
        info_cache: {
          Default: { name: 'Duy', gaia_name: 'Duy Đình', gaia_given_name: 'Duy', user_name: 'ca-nhan@gmail.com' },
          'Profile 1': {
            name: 'Media',
            gaia_name: 'Media Tub',
            gaia_given_name: 'Media',
            user_name: 'tubmediatool@gmail.com'
          },
          'Profile 2': {
            name: 'Capcut Pro',
            gaia_name: 'Monkey.D Vien',
            gaia_given_name: 'Monkey.D',
            user_name: 'capcut@gmail.com'
          }
        }
      }
    }),
    'utf8'
  );

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        LOCALAPPDATA: fakeLocalAppData,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    // Sự cố phát hành 1.5.0 (2026-09-26): trên máy CI chậm hơn, bài này bấm điều hướng sang trang Cài
    // đặt NGAY sau khi cửa sổ vừa mở — đúng lúc app còn đang bận tự kết nối/kiểm tra công cụ (yt-dlp/
    // FFmpeg/ffprobe/aria2c) ở nền, tranh chấp CPU khiến việc bấm bị coi "chưa sẵn sàng tương tác" và
    // vượt quá 8 giây (đã tái hiện cục bộ bằng CDP throttling CPU 8x: cùng thao tác luôn THÀNH CÔNG
    // nhưng mất 5,6-7,2 giây — quá sát ngưỡng 8 giây cũ khi máy CI còn chậm/tải hơn nữa). Đợi đúng tín
    // hiệu "công cụ sẵn sàng" thật ở Topbar trước khi điều hướng — đúng thời điểm ứng dụng đã ổn định,
    // không phải một khoảng chờ tùy tiện.
    await shellWindow.waitForSelector('.tool-status-button.is-ready', { timeout: 30_000 });

    // Gọi thẳng kênh IPC thật (đúng đường dữ liệu main process đọc Local State thật) — xác nhận cả 3
    // hồ sơ giả được nhận diện đúng, đúng tên hiển thị, đúng hồ sơ "dùng gần nhất".
    interface DesktopCookiesApi {
      cookies: {
        listBrowserProfiles: (
          browser: string
        ) => Promise<Array<{ id: string; label: string; isLastUsed: boolean }>>;
      };
    }
    const profiles = await shellWindow.evaluate(() =>
      (window as unknown as { desktop: DesktopCookiesApi }).desktop.cookies.listBrowserProfiles('chrome')
    );
    expect(profiles, 'phải nhận diện đủ 3 hồ sơ giả lập').toHaveLength(3);
    expect(profiles.find((item) => item.id === 'Profile 1')?.isLastUsed, 'đúng hồ sơ dùng gần nhất').toBe(
      true
    );
    expect(profiles.filter((item) => item.isLastUsed)).toHaveLength(1);

    // Luồng giao diện thật: Cài đặt → mục "Tải danh sách" (nơi có khối Cookies) → Quản lý cookies →
    // tab Lấy từ trình duyệt → chọn Chrome.
    // Dùng đúng vai trò (role) trong đúng vùng điều hướng (<nav aria-label="Điều hướng chính">) thay vì
    // selector chữ mơ hồ "text=Cài đặt" — tránh khớp nhầm phần tử khác cũng chứa chữ "Cài đặt" ở nơi
    // khác trong ứng dụng (vd nút "Cài đặt & khởi động lại" ở trang Cập nhật).
    await shellWindow
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('button', { name: 'Cài đặt', exact: true })
      .click({ timeout: 20_000 });
    // "Tải danh sách" cũng là tên một trang chính ở sidebar ngoài cùng — phải giới hạn đúng trong menu
    // mục con của trang Cài đặt (.settings-nav) để không bấm nhầm điều hướng sang trang khác.
    await shellWindow.locator('.settings-nav').getByRole('button', { name: 'Tải danh sách', exact: true }).click();
    await shellWindow.getByRole('button', { name: 'Quản lý cookies' }).click();
    const dialog = shellWindow.locator('[role="dialog"][aria-label="Quản lý cookies"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Lấy từ trình duyệt' }).click();
    await dialog.getByLabel('Trình duyệt', { exact: true }).selectOption('chrome');

    // Dropdown hồ sơ phải hiện đủ 3 hồ sơ thật + 1 lựa chọn "nhập tay", không phải ô gõ tay như trước.
    const profileSelect = dialog.getByLabel('Hồ sơ trình duyệt');
    await expect(profileSelect).toBeVisible({ timeout: 5_000 });
    await expect(profileSelect.locator('option')).toHaveCount(4);

    // Mặc định phải TỰ CHỌN SẴN đúng hồ sơ "dùng gần nhất" (Profile 1/Media) — hiển thị rõ ràng thay vì
    // âm thầm để trống rồi bị yt-dlp tự chọn không ai biết.
    await expect(dialog).toContainText('Sẽ lấy cookies của:');
    await expect(dialog).toContainText('Media — tubmediatool@gmail.com');

    // Chọn đúng hồ sơ KHÁC (Capcut Pro/Profile 2) — xác nhận chọn đúng, không lẫn giữa các hồ sơ.
    await profileSelect.selectOption({ label: 'Capcut Pro — capcut@gmail.com' });
    await expect(dialog).toContainText('Sẽ lấy cookies của: Capcut Pro — capcut@gmail.com');

    await dialog.getByRole('button', { name: 'Dùng trình duyệt này' }).click();
    const attention = shellWindow.locator('.attention-center');
    await expect(attention, 'phải xác nhận rõ đã lấy cookies của đúng hồ sơ/tài khoản nào').toBeVisible({
      timeout: 8_000
    });
    await expect(attention).toContainText('Đã dùng hồ sơ/tài khoản: Capcut Pro — capcut@gmail.com');

    // Lưu đúng vào cấu hình thật (không chỉ hiển thị) — Profile 2 là tên thư mục kỹ thuật thật.
    const status = await shellWindow.evaluate(() =>
      (window as unknown as { desktop: { cookies: { status: () => Promise<{ browserProfile: string }> } } })
        .desktop.cookies.status()
    );
    expect(status.browserProfile).toBe('Profile 2');
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Tính năng C1 (2026-09-26) — "Gợi ý điểm cắt tự động" (khoảng lặng + đổi cảnh, KHÔNG dùng AI). Dựng một
 * video mẫu THẬT có cấu trúc biết trước (đỏ+có tiếng 3s, xanh dương+im lặng 2s, xanh lá+có tiếng 3s —
 * đã đối chiếu định dạng output thật của FFmpeg 8.1.2 trước khi viết regex phân tích, xem
 * tests/unit/cut-suggestion.test.ts) rồi lái đúng luồng giao diện thật: bấm nút "Gợi ý điểm cắt tự động"
 * → xem danh sách → bấm "Dùng đoạn này" → xác nhận 2 ô Mốc bắt đầu/kết thúc được điền đúng.
 */
test('C1: gợi ý điểm cắt tự động tìm đúng khoảng lặng/đổi cảnh và điền đúng vào ô mốc khi bấm "Dùng đoạn này"', async () => {
  const toolsDirectory = resolveToolsDirectoryForTest();
  test.skip(!toolsDirectory, 'Không tìm thấy ffmpeg/ffprobe trên máy này để chạy bài kiểm thật.');

  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-cut-suggestion-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  fs.mkdirSync(path.join(userDataDirectory, 'database'), { recursive: true });
  fs.mkdirSync(path.join(userDataDirectory, 'quick-download'), { recursive: true });

  const sourceFile = path.join(sandbox, 'video-mau-c1.mp4');
  const ffmpegResult = spawnSync(
    path.join(toolsDirectory!, 'ffmpeg.exe'),
    [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=3,format=yuv420p',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=2,format=yuv420p',
      '-f', 'lavfi', '-i', 'anullsrc=duration=2',
      '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=3,format=yuv420p',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
      '-filter_complex', '[0:v][2:v][4:v]concat=n=3:v=1:a=0[v];[1:a][3:a][5:a]concat=n=3:v=0:a=1[a]',
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', sourceFile
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  expect(ffmpegResult.status, 'ffmpeg phải dựng được video mẫu (đỏ/xanh dương im lặng/xanh lá)').toBe(0);

  const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run(
    'app',
    JSON.stringify({
      theme: 'dark',
      startWithWindows: false,
      autoCheckAppUpdates: false,
      autoCheckToolUpdates: false,
      ffmpegPath: path.join(toolsDirectory!, 'ffmpeg.exe'),
      ffprobePath: path.join(toolsDirectory!, 'ffprobe.exe')
    }),
    new Date().toISOString()
  );
  db.close();

  // Seed thẳng trạng thái Tải nhanh "vừa hoàn tất" trỏ tới video mẫu — để dùng đúng nút "Cắt đoạn này"
  // có sẵn trên giao diện thay vì hộp thoại chọn tệp gốc hệ điều hành (Playwright không lái được).
  fs.writeFileSync(
    path.join(userDataDirectory, 'quick-download', 'state.json'),
    JSON.stringify({
      version: 1,
      statuses: [
        {
          taskId: randomUUID(),
          mode: 'full',
          mediaMode: 'video-audio',
          phase: 'completed',
          progress: 100,
          title: 'Video mẫu C1',
          message: 'Đã tải và kiểm tra hoàn tất.',
          speed: '',
          eta: '',
          downloadedBytes: 0,
          totalBytes: 0,
          outputPath: sourceFile,
          outputDirectory: sandbox,
          requestedStartSeconds: null,
          requestedEndSeconds: null,
          actualDurationSeconds: 8.02,
          accurateCut: false,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          error: null,
          errorCode: null,
          warnings: []
        }
      ]
    }),
    'utf8'
  );

  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    await shellWindow.waitForSelector('.tool-status-button.is-ready', { timeout: 30_000 });

    // Xác nhận trước bằng IPC thật (không qua giao diện) — cùng đường dữ liệu main process thật, khớp
    // đúng với bài kiểm đơn vị đã xác nhận qua dữ liệu FFmpeg output thật.
    interface DesktopCutSuggestApi {
      localCut: {
        suggestCutPoints: (
          filePath: string
        ) => Promise<Array<{ startSeconds: number; endSeconds: number; startReason: string; endReason: string }>>;
      };
    }
    const directSuggestions = await shellWindow.evaluate(
      (filePath) =>
        (window as unknown as { desktop: DesktopCutSuggestApi }).desktop.localCut.suggestCutPoints(filePath),
      sourceFile
    );
    expect(directSuggestions.length, 'phải tìm được ít nhất 1 đoạn gợi ý qua IPC thật').toBeGreaterThan(0);
    expect(directSuggestions[0]?.startSeconds).toBeCloseTo(0, 1);
    expect(directSuggestions[0]?.endSeconds).toBeCloseTo(3.02, 1);

    // Luồng giao diện thật: Xem trước & Cắt → dùng video "vừa tải" → bấm Gợi ý điểm cắt tự động.
    await shellWindow.click('text=Xem trước & Cắt');
    await shellWindow.getByRole('button', { name: 'Cắt đoạn này' }).click();
    await shellWindow.waitForSelector('text=Cắt tệp có sẵn trên máy', { timeout: 10_000 });

    const suggestButton = shellWindow.getByRole('button', { name: 'Gợi ý điểm cắt tự động' });
    await expect(suggestButton, 'phải có đúng nút gợi ý, không gọi nhầm là "AI"').toBeVisible();
    await suggestButton.click();

    const suggestionList = shellWindow.locator('.local-cut-suggestion-list li');
    await expect(suggestionList.first(), 'phải hiện ít nhất 1 đoạn gợi ý trên giao diện thật').toBeVisible({
      timeout: 20_000
    });
    const suggestionCount = await suggestionList.count();
    expect(suggestionCount).toBeGreaterThan(0);
    expect(suggestionCount, 'giới hạn tối đa 8 đoạn đã hỏi và được chọn').toBeLessThanOrEqual(8);

    // Bấm "Dùng đoạn này" của gợi ý ĐẦU TIÊN — phải điền đúng vào 2 ô Mốc bắt đầu/kết thúc có sẵn.
    await suggestionList.first().getByRole('button', { name: 'Dùng đoạn này' }).click();
    const startTimeValue = await shellWindow.locator('.local-cut-field input').first().inputValue();
    const endTimeValue = await shellWindow.locator('.local-cut-field input').nth(1).inputValue();
    expect(startTimeValue, 'ô Mốc bắt đầu phải được điền đúng theo đoạn gợi ý đầu tiên').toBe('00:00:00');
    expect(endTimeValue, 'ô Mốc kết thúc phải được điền đúng theo đoạn gợi ý đầu tiên').toBe('00:00:03');
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Mục 5 (2026-10-02) — giao diện khu cách ly trên Electron thật, dữ liệu sandbox:
 * - khi mở app: thư mục _quarantine cũ còn tệp → nhắc kèm "Mở thư mục" (không di chuyển, không xóa);
 *   mục Dọn dẹp máy sắp bị xóa vĩnh viễn trong 2 ngày → nhắc kèm "Xem" (cuộn tới đúng khu);
 * - trang Dọn dẹp máy: "Khu cách ly của danh sách" hiện tổng dung lượng, từng tệp, tên danh sách, nút xóa có chọn.
 * Không bấm xóa thật (xóa chỉ được phép bên trong <ổ>:\Tubmedia\quarantine thật).
 */
test('Mục 5: nhắc khu cách ly khi mở app và trang xem khu cách ly của danh sách', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-quarantine-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
  };

  try {
    // Lần mở đầu chỉ để ứng dụng tự tạo CSDL đủ bảng (kể cả quarantine_items).
    await launch();
    await closeElectronApplication();

    const projectId = randomUUID();
    const tempFolder = path.join(sandbox, 'Downloads');
    const legacy = path.join(tempFolder, '_quarantine');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'ban-cu-tu-1.5.0.mp4'), Buffer.alloc(2048));
    const kept = path.join(sandbox, 'Tubmedia', 'quarantine', 'Danh sách e2e (abcd1234)', '1-abc-Video cũ [LINK_AAAAAAAAAAAA].mp4');
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.writeFileSync(kept, Buffer.alloc(4096));

    const now = new Date().toISOString();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    db.prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,aspect_ratio,created_at,updated_at,archived_at)
       VALUES(?,?,NULL,'','draft',?,?,?,?,'x','q','r',0,'original',?,?,NULL)`
    ).run(projectId, 'Danh sách e2e', path.join(sandbox, 'video'), tempFolder, path.join(sandbox, 'video'), legacy, now, now);
    db.prepare(
      `INSERT INTO quarantine_items(id,project_id,job_id,source_id,kind,original_path,quarantine_path,bytes,reason,created_at,replacement_path,replaced_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      randomUUID(), projectId, 'job-e2e', 'src-e2e', 'outdated-source',
      path.join(sandbox, 'video', 'Video cũ [LINK_AAAAAAAAAAAA].mp4'), kept, 4096,
      'Tệp cũ không khớp chính sách.', now, path.join(sandbox, 'video', 'Video cũ [LINK_AAAAAAAAAAAA].mp4'), now
    );
    db.close();

    const cleanupQuarantine = path.join(userDataDirectory, 'cleanup-quarantine');
    fs.mkdirSync(cleanupQuarantine, { recursive: true });
    const day = 24 * 60 * 60 * 1000;
    fs.writeFileSync(
      path.join(cleanupQuarantine, 'manifest.json'),
      JSON.stringify([
        {
          id: randomUUID(), runId: 'run-e2e', categoryId: 'userTemp', originalPath: path.join(sandbox, 'tmp.bin'), bytes: 10,
          quarantinedAt: new Date(Date.now() - 13 * day).toISOString(), expiresAt: new Date(Date.now() + day).toISOString(),
          restoredAt: null, restoredPath: null, purgedAt: null
        }
      ])
    );

    await launch();
    await electronApplication!.evaluate(({ shell }) => {
      const calls: string[] = [];
      (globalThis as unknown as { __openedPaths: string[] }).__openedPaths = calls;
      shell.openPath = (target: string) => {
        calls.push(target);
        return Promise.resolve('');
      };
    });

    // Phần A rà soát giao diện (2026-10-06): lời nhắc khu cách ly lúc mở app nằm trong CHUÔNG thông báo, không còn banner.
    await shellWindow!.waitForTimeout(1500);
    expect(await shellWindow!.locator('.storage-attention-notice').count(), 'không còn banner đầu trang').toBe(0);
    await shellWindow!.locator('#notification-center-trigger').click();
    const legacyItem = shellWindow!.locator('.notification-item', { hasText: 'Thư mục cách ly cũ còn 1 tệp' });
    await expect(legacyItem).toBeVisible({ timeout: 15_000 });
    await expect(legacyItem).toContainText(legacy);
    const expiringItem = shellWindow!.locator('.notification-item', { hasText: 'sắp bị xóa vĩnh viễn' });
    await expect(expiringItem).toContainText('trong 2 ngày tới');

    await legacyItem.getByRole('button', { name: 'Mở thư mục' }).click();
    await expect
      .poll(async () => electronApplication!.evaluate(() => (globalThis as unknown as { __openedPaths: string[] }).__openedPaths))
      .toEqual([legacy]);
    expect(fs.existsSync(path.join(legacy, 'ban-cu-tu-1.5.0.mp4')), 'thư mục cũ không bị di chuyển/xóa').toBe(true);

    await expiringItem.getByRole('button', { name: 'Xem khu cách ly' }).click();
    await expect(shellWindow!.locator('#cleanup-quarantine')).toBeVisible({ timeout: 15_000 });
    await expect(shellWindow!.locator('#cleanup-quarantine')).toContainText('còn 1 ngày để hoàn tác');

    const panel = shellWindow!.locator('[data-testid="project-quarantine-panel"]');
    await expect(panel).toContainText('Video cũ [LINK_AAAAAAAAAAAA].mp4');
    await expect(panel).toContainText('Danh sách e2e');
    await expect(panel).toContainText('Bản cũ — đã có bản mới thay');
    await expect(panel).toContainText('4.0 KB');
    await expect(panel.getByRole('button', { name: /Xóa các bản cũ đã chọn/ })).toBeDisabled();
    await panel.locator('input[type="checkbox"]').first().check();
    await expect(panel.getByRole('button', { name: /Xóa các bản cũ đã chọn \(1\)/ })).toBeEnabled();
    expect(fs.existsSync(kept), 'không có gì bị xóa khi chỉ xem/chọn').toBe(true);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Đợt 3 — trang Nhật ký (rà soát bản cài 1.5.0, 2026-10-02). Dựng CSDL có sẵn nhật ký CŨ (trước lần mở app này)
 * rồi kiểm trang Nhật ký trên Electron thật.
 * Mục 6: mở trang là phải thấy lịch sử — trước đây chỉ thấy ~100 dòng nạp lúc mở app (cần bấm "Làm mới").
 */
test('Đợt 3: trang Nhật ký hiện lịch sử ngay khi mở', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-logs-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
  };

  try {
    await launch();
    await closeElectronApplication();

    // 300 dòng "thông tin" từ hôm qua — nhiều hơn 100 dòng ứng dụng nạp sẵn lúc mở.
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    const insertLog = db.prepare(
      'INSERT INTO event_logs(id,timestamp,level,module,project_id,job_id,attempt_id,event_code,message,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
    );
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    for (let index = 0; index < 300; index += 1) {
      insertLog.run(randomUUID(), new Date(yesterday + index * 1000).toISOString(), 'info', 'queue', null, null, null, 'E2E_OLD_INFO', `Sự kiện cũ số ${index}`, null);
    }
    db.close();

    await launch();
    await shellWindow!
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('button', { name: 'Nhật ký', exact: true })
      .click();

    // Không bấm "Làm mới": mở trang là phải thấy cả 300 sự kiện cũ.
    await expect
      .poll(async () => shellWindow!.locator('.logs-data-table tbody tr', { hasText: 'Sự kiện cũ số' }).count(), { timeout: 15_000 })
      .toBe(300);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Người dùng báo sau phát hành 1.6.0 (2026-10-06, kèm ảnh thật): (1) banner lớn "N danh sách đang dùng thư mục chung
 * làm thư mục tạm" ở đầu MỌI trang; (2) dòng cảnh báo dài dưới ô "Thư mục tạm" làm lệch cả hàng cấu hình (lưới căn
 * đáy — đo thật: ô tạm top 757, ô bên cạnh 794/854 trong CÙNG một hàng). Phương án A đã duyệt: bỏ banner, thay dòng
 * chữ bằng nhãn ⚠ nhỏ cùng hàng với tên ô, câu đầy đủ hiện khi rê chuột/focus (title + aria-label).
 * Đường dẫn "Downloads" là GIẢ (C:\Users\TubmediaE2E\Downloads) — không đụng thư mục thật nào.
 */
test('Cảnh báo thư mục tạm dùng chung: không có banner đầu trang, ô cùng hàng thẳng nhau, nhãn ⚠ có giải thích', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-shared-temp-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const fakeDownloads = 'C:\\Users\\TubmediaE2E\\Downloads';
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
  };
  const goTo = async (label: string): Promise<void> => {
    await shellWindow!.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('button', { name: label, exact: true }).click();
  };
  // Số tọa độ top khác nhau của các ô nhập trong lưới cấu hình phải đúng bằng số hàng của lưới.
  const rowAlignment = async (): Promise<{ rows: number; tops: number[] }> =>
    shellWindow!.evaluate(() => {
      const grid = document.querySelector('.compact-config-grid');
      if (!grid) return { rows: -1, tops: [] };
      const rows = getComputedStyle(grid).gridTemplateRows.split(' ').filter(Boolean).length;
      const tops = Array.from(grid.querySelectorAll('input, select'))
        .map((element) => Math.round(element.getBoundingClientRect().top))
        .sort((a, b) => a - b);
      // Gom các ô lệch nhau ≤ 2px thành một hàng: ô chọn cao 35px, ô nhập 34px nên vốn lệch 1px (có từ trước, mắt
      // không thấy). Lỗi cần bắt lệch hàng chục px (757/794/854).
      const groups = tops.filter((top, index) => index === 0 || top - tops[index - 1]! > 2);
      return { rows, tops: groups };
    });
  // Icon ⚠ nhỏ cạnh tên ô; câu đầy đủ KHÔNG hiện cứng — chỉ hiện khi rê chuột vào icon.
  const expectSharedChip = async (scope: string): Promise<void> => {
    const chip = shellWindow!.locator(`${scope} .shared-folder-chip`).first();
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-label', /Tải xuống \(Downloads\).*thư mục riêng/);
    const tip = chip.locator('.shared-folder-tip');
    await shellWindow!.mouse.move(0, 0);
    await expect(tip, 'câu giải thích không để cứng trên giao diện').toBeHidden();
    await chip.hover();
    await expect(tip, 'rê chuột vào ⚠ thì hiện đủ câu giải thích').toBeVisible();
    await expect(tip).toContainText('Tải xuống (Downloads)');
    await expect(tip).toContainText('Nên chọn một thư mục riêng cho Tubmedia');
    await expect(tip).toContainText('tệp tạm không lẫn với tệp cá nhân');
    await shellWindow!.mouse.move(0, 0);
    await expect(tip).toBeHidden();
    expect(await shellWindow!.locator(`${scope} .field-hint-warning`).count(), 'không còn dòng chữ dài dưới ô').toBe(0);
  };

  try {
    await launch();
    await closeElectronApplication();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    const now = new Date().toISOString();
    const insertProject = db.prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,aspect_ratio,created_at,updated_at,archived_at)
       VALUES(?,?,?,'','draft',?,?,?,?,'x','quality-source-size','resource-balanced',0,'original',?,?,NULL)`
    );
    const laneIds: string[] = [];
    for (const lane of [1, 2, 3]) {
      const output = path.join(sandbox, `video-${lane}`);
      const id = randomUUID();
      laneIds.push(id);
      insertProject.run(id, `Danh sách tải ${lane}`, `__WORKBENCH_DOWNLOAD_${lane}__`, output, fakeDownloads, output, path.join(sandbox, 'q'), now, now);
    }
    // "Không nhắc lại" đã lưu từ 1.6.0 cho Danh sách tải 2 (đúng thư mục này) — vẫn phải được tôn trọng.
    db.prepare(
      'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
    ).run('app_extra', JSON.stringify({ autoResumeInterruptedOnStartup: false, dismissedSharedTempWarnings: { [laneIds[1]!]: fakeDownloads } }), now);
    db.close();

    await launch();
    // Đợi danh sách đã nạp xong (thấy tên danh sách đã dựng) rồi mới kiểm banner — kiểm quá sớm thì banner chưa kịp
    // hiện và bài kiểm xanh nhầm (đã gặp khi viết bài này).
    await goTo('Tải danh sách');
    await expect(shellWindow!.locator('.workflow-tab', { hasText: 'Danh sách tải 1' })).toBeVisible({ timeout: 15_000 });
    await shellWindow!.waitForTimeout(1000);
    expect(await shellWindow!.locator('.shared-temp-folder-notice').count(), 'không còn banner lớn đầu trang').toBe(0);

    for (const [page, scope, label] of [
      ['Tải danh sách', '.compact-config-temp', 'Thư mục tạm'],
      ['Ghép theo Timeline', '.compact-config-temp', 'Thư mục xử lý tạm']
    ] as const) {
      await goTo(page);
      const tempInput = shellWindow!.locator(`${scope} input`).first();
      await expect(tempInput).toBeVisible({ timeout: 15_000 });
      if ((await tempInput.inputValue()) !== fakeDownloads) await tempInput.fill(fakeDownloads);
      await expect(shellWindow!.locator(`${scope}`).first()).toContainText(label);
      await expectSharedChip(scope);
      for (const width of [1400, 1600]) {
        await shellWindow!.setViewportSize({ width, height: 900 });
        await shellWindow!.waitForTimeout(400);
        const { rows, tops } = await rowAlignment();
        expect(tops.length, `${page} ${width}px: ${rows} hàng nhưng ô nhập nằm ở ${tops.join('/')}`).toBe(rows);
      }
      if (page === 'Tải danh sách') {
        // Danh sách tải 2 đã "Không nhắc lại" cho đúng thư mục này: không hiện ⚠; vẫn dùng bình thường (ô không bị khóa).
        await shellWindow!.locator('.workflow-tab', { hasText: 'Danh sách tải 2' }).click();
        const laneTwoTemp = shellWindow!.locator(`${scope} input`).first();
        await expect(laneTwoTemp).toHaveValue(fakeDownloads, { timeout: 10_000 });
        await expect(laneTwoTemp).toBeEnabled();
        expect(await shellWindow!.locator(`${scope} .shared-folder-chip`).count(), 'danh sách đã chọn "Không nhắc lại"').toBe(0);
        await shellWindow!.locator('.workflow-tab', { hasText: 'Danh sách tải 1' }).click();
      }
    }

    await goTo('Cài đặt');
    await shellWindow!.getByRole('button', { name: 'Lưu trữ', exact: true }).click();
    const settingsTemp = shellWindow!.locator('label', { hasText: 'Thư mục tạm mặc định' }).first();
    await settingsTemp.locator('input').fill(fakeDownloads);
    await expect(settingsTemp.locator('.shared-folder-chip')).toBeVisible();
    await expect(settingsTemp.locator('.shared-folder-chip')).toHaveAttribute('aria-label', /Tải xuống \(Downloads\)/);
    await settingsTemp.locator('.shared-folder-chip').hover();
    await expect(settingsTemp.locator('.shared-folder-tip')).toBeVisible();
    expect(await settingsTemp.locator('.field-hint-warning').count()).toBe(0);
    expect(fs.existsSync('C:\\Users\\TubmediaE2E'), 'không tạo thư mục thật nào ở đường dẫn giả').toBe(false);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Sau phát hành 1.6.0 (2026-10-06): người dùng bấm X nhưng app không thoát hẳn, phải End Task. Chưa tái hiện được
 * bằng thao tác thường; điểm yếu là before-quit chờ từng bước dọn dẹp không giới hạn. Ở chế độ e2e, biến
 * TUBMEDIA_E2E_SHUTDOWN_HANG_STEP cố ý làm TREO một bước để chứng minh: app vẫn thoát hẳn trong giới hạn và
 * logs\shutdown.log ghi rõ bước nào quá giờ.
 */
test('Thoát an toàn: một bước dọn dẹp bị treo vẫn thoát hẳn trong giới hạn và có nhật ký thoát', async () => {
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-shutdown-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  try {
    electronApplication = await electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        NODE_ENV: 'test',
        TUBMEDIA_E2E: '1',
        TUBMEDIA_E2E_USER_DATA: userDataDirectory,
        TUBMEDIA_E2E_SHUTDOWN_HANG_STEP: 'queue',
        PLAYWRIGHT_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 45_000
    });
    const child = electronApplication.process();
    mainProcessId = child.pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    const exited = new Promise<number>((resolveExit) => child.once('exit', () => resolveExit(Date.now())));

    // Đúng đường của nút X: sự kiện 'close' của cửa sổ → requestClose (0 tác vụ → thoát).
    const closedAt = Date.now();
    await electronApplication.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()).catch(() => undefined);
    const exitAt = await Promise.race([exited, sleep(25_000).then(() => -1)]);
    expect(exitAt, 'app phải tự thoát hẳn dù bước "queue" bị treo').toBeGreaterThan(0);
    expect(exitAt - closedAt, 'thoát trong giới hạn 15 giây (+ dự phòng)').toBeLessThan(18_000);

    const trail = fs.readFileSync(path.join(userDataDirectory, 'logs', 'shutdown.log'), 'utf8');
    expect(trail).toContain('BẮT ĐẦU THOÁT');
    expect(trail).toMatch(/queue.*QUÁ GIỜ/);
    expect(trail).toMatch(/processes.*ok/);
    expect(trail).toContain('THOÁT XONG');
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Phần B rà soát thông báo (người dùng duyệt 2026-10-06). Gửi thông báo/nhật ký từ tiến trình chính qua ĐÚNG kênh sự
 * kiện app dùng thật (events:attention, events:log) rồi kiểm giao diện:
 *  - cùng vấn đề (nhóm mã lỗi + danh sách) → THAY bằng bản mới nhất, không chồng; khác vấn đề → xếp hàng hiện đủ;
 *  - bấm X → không hiện lại vấn đề tương tự, nhớ qua lần mở app tới khi danh sách hết bị chặn;
 *  - mọi thông báo tự tắt (lỗi chặn việc ≥ 12 giây);
 *  - khung chẩn đoán không lặp lại vấn đề của danh sách; lỗi cấp app đã tắt thì không bật lại cùng loại.
 */
test('Phần B thông báo: thay thông báo trùng, đã tắt thì không hiện lại, tự tắt, một vấn đề một nơi', async () => {
  test.setTimeout(150_000);
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-notices-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    await shellWindow.waitForTimeout(1500);
  };
  const send = async (channel: string, payload: unknown): Promise<void> => {
    await electronApplication!.evaluate(
      ({ BrowserWindow }, [name, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(name, data),
      [channel, payload] as const
    );
  };
  const center = (): ReturnType<Page['locator']> => shellWindow!.locator('.attention-center');
  const projectId = randomUUID();
  const jobId = randomUUID();
  const diskFull = (message: string): Record<string, unknown> => ({
    id: `disk-${randomUUID()}`, severity: 'error', title: 'Ổ đĩa không đủ dung lượng', message, code: 'DISK_FULL', projectId, sticky: true
  });

  try {
    await launch();
    await closeElectronApplication();
    const now = new Date().toISOString();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    db.prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,aspect_ratio,created_at,updated_at,archived_at)
       VALUES(?,?,NULL,'','failed',?,?,?,?,'x','quality-source-size','resource-balanced',0,'original',?,?,NULL)`
    ).run(projectId, 'Danh sách e2e', sandbox, sandbox, sandbox, sandbox, now, now);
    db.prepare(
      `INSERT INTO queue_jobs(id,project_id,type,status,priority,input_json,progress,attempts,max_attempts,error_code,error_message,created_at,updated_at)
       VALUES(?,?,'download','failed',0,?,0,3,3,'DISK_FULL','Ổ đầy',?,?)`
    ).run(jobId, projectId, JSON.stringify({ url: 'https://example.com/video' }), now, now);
    db.close();

    await launch();
    await shellWindow!.mouse.move(5, 5);

    // 1) Cùng vấn đề gửi 3 lần liên tiếp → chỉ MỘT thông báo, nội dung mới nhất, không có "+N".
    for (const message of ['lần 1', 'lần 2', 'lần 3']) await send('events:attention', diskFull(message));
    await shellWindow!.waitForTimeout(600);
    await expect(center()).toHaveCount(1);
    await expect(center()).toContainText('lần 3');
    await expect(shellWindow!.locator('.attention-queue-label')).toHaveCount(0);

    // 2) Vấn đề KHÁC loại → xếp hàng, không bị gộp nhầm.
    await send('events:attention', {
      id: `rate-${randomUUID()}`, severity: 'warning', title: 'Máy chủ video tạm từ chối', message: 'giới hạn tải', code: 'SOURCE_RATE_LIMITED', projectId
    });
    await expect(shellWindow!.locator('.attention-queue-label')).toHaveText('+1');

    // 3) Bấm X: thông báo kế tiếp (khác loại) hiện ra đầy đủ; tắt nốt.
    await center().locator('.attention-close').click();
    await expect(center()).toContainText('giới hạn tải', { timeout: 5_000 });
    await center().locator('.attention-close').click();
    await expect(center()).toHaveCount(0, { timeout: 5_000 });

    // 4) Vấn đề đã tắt xảy ra tiếp → KHÔNG hiện lại.
    await send('events:attention', diskFull('lần 4'));
    await shellWindow!.waitForTimeout(1200);
    await expect(center()).toHaveCount(0);

    // 5) Mở lại app, danh sách VẪN bị chặn → vẫn không hiện lại.
    await closeElectronApplication();
    await launch();
    await shellWindow!.mouse.move(5, 5);
    await send('events:attention', diskFull('lần 5'));
    await shellWindow!.waitForTimeout(1200);
    await expect(center()).toHaveCount(0);

    // 6) Tình huống đổi khác (danh sách hết bị chặn) → lần chặn mới HIỆN lại, và tự tắt sau ≥ 12 giây.
    await closeElectronApplication();
    const db2 = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    db2.prepare("UPDATE queue_jobs SET status='completed', error_code=NULL, error_message=NULL WHERE id=?").run(jobId);
    db2.close();
    await launch(); // mở app lúc danh sách đã hết bị chặn → bỏ ghi nhớ "đã tắt"
    await closeElectronApplication();
    // Lần bị chặn MỚI (thông báo ổ đầy thật chỉ đến khi danh sách đang bị chặn; nếu không, thông báo tự đóng sớm vì
    // vấn đề đã được giải quyết — cơ chế cũ vẫn giữ).
    const db3 = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    db3.prepare("UPDATE queue_jobs SET status='failed', error_code='DISK_FULL', error_message='Ổ đầy lần mới' WHERE id=?").run(jobId);
    db3.close();
    await launch();
    await shellWindow!.mouse.move(5, 5);
    await send('events:attention', diskFull('lần 6'));
    await expect(center()).toContainText('lần 6', { timeout: 5_000 });
    const shownAt = Date.now();
    await expect(center()).toHaveCount(0, { timeout: 16_000 });
    expect(Date.now() - shownAt, 'lỗi chặn việc hiện tối thiểu ~12 giây').toBeGreaterThan(10_500);

    // 7) Khung chẩn đoán: nhật ký gắn danh sách không lặp lại ở đây; lỗi cấp app hiện, tắt rồi không bật lại cùng loại.
    const log = (over: Record<string, unknown>): Record<string, unknown> => ({
      id: randomUUID(), timestamp: new Date().toISOString(), level: 'error', module: 'download', eventCode: 'JOB_FAILED', message: 'Video lỗi', ...over
    });
    await send('events:log', log({ projectId, jobId }));
    await shellWindow!.waitForTimeout(1500);
    await expect(shellWindow!.locator('.diagnostic-dock')).toHaveCount(0);
    await send('events:log', log({ module: 'tools', eventCode: 'TOOL_HEALTH_CHECK_FAILED', message: 'Công cụ lỗi lần 1' }));
    await expect(shellWindow!.locator('.diagnostic-dock')).toBeVisible({ timeout: 5_000 });
    await shellWindow!.locator('.diagnostic-dock').getByRole('button', { name: 'Đóng thông báo này' }).click();
    await expect(shellWindow!.locator('.diagnostic-dock')).toHaveCount(0);
    await send('events:log', log({ module: 'tools', eventCode: 'TOOL_HEALTH_CHECK_FAILED', message: 'Công cụ lỗi lần 2' }));
    await shellWindow!.waitForTimeout(1500);
    await expect(shellWindow!.locator('.diagnostic-dock')).toHaveCount(0);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Phần A rà soát giao diện (người dùng duyệt 2026-10-06): không còn đoạn chữ dài đứng cố định trên giao diện — giải
 * thích dài nằm trong icon ⓘ (hiện đủ khi rê chuột/focus), phụ đề trang rút gọn một dòng. Bài này đi qua MỌI trang và
 * mọi mục Cài đặt, tìm phần tử ĐANG HIỂN THỊ có đoạn chữ riêng dài > 110 ký tự (bỏ qua hộp thoại, ô chú thích ⓘ, thông
 * báo nổi, ô nhập). Banner khu cách ly lúc mở app chuyển vào chuông thông báo; trang Tổng quan ghi đúng 6 danh sách.
 */
test('Phần A giao diện: không còn chữ dài cố định, ⓘ hiện đủ khi rê chuột, banner khu cách ly vào chuông', async () => {
  test.setTimeout(150_000);
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-long-text-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    await shellWindow.setViewportSize({ width: 1400, height: 900 });
  };
  const longVisibleTexts = async (): Promise<string[]> =>
    shellWindow!.evaluate(() => {
      const skip = '[role="dialog"], .info-hint-tip, .shared-folder-tip, .attention-center, .diagnostic-dock, input, textarea, select, pre, code, .logs-data-table, #notification-center-panel, .info-disclosure:not(.is-open) .info-disclosure-collapse, details:not([open]) > :not(summary)';
      const found: string[] = [];
      for (const element of Array.from(document.querySelectorAll('main *, .app-main *'))) {
        if (element.closest(skip)) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const own = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        // Bỏ qua dữ liệu dạng đường dẫn (ví dụ đường dẫn công cụ) — không phải chữ giải thích.
        if (own.length > 110 && !/^[A-Za-z]:[\\/]/.test(own)) found.push(own.slice(0, 90));
      }
      return [...new Set(found)];
    });
  const goTo = async (label: string): Promise<void> => {
    await shellWindow!.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('button', { name: label, exact: true }).click();
    await shellWindow!.waitForTimeout(700);
  };

  try {
    // Dựng thư mục _quarantine cũ còn tệp để kiểm banner khu cách ly đã chuyển vào chuông.
    await launch();
    await closeElectronApplication();
    const legacy = path.join(sandbox, 'Downloads', '_quarantine');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'ban-cu.mp4'), Buffer.alloc(2048));
    const now = new Date().toISOString();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    db.prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,aspect_ratio,created_at,updated_at,archived_at)
       VALUES(?,?,NULL,'','draft',?,?,?,?,'x','q','r',0,'original',?,?,NULL)`
    ).run(randomUUID(), 'Danh sách e2e', sandbox, path.join(sandbox, 'Downloads'), sandbox, legacy, now, now);
    db.close();

    await launch();
    await shellWindow!.waitForTimeout(2000);
    expect(await shellWindow!.locator('.storage-attention-notice').count(), 'không còn banner khu cách ly đầu trang').toBe(0);
    await shellWindow!.locator('#notification-center-trigger').click();
    const bell = shellWindow!.locator('#notification-center-panel');
    await expect(bell).toContainText('Thư mục cách ly cũ còn 1 tệp', { timeout: 10_000 });
    await expect(bell.getByRole('button', { name: 'Mở thư mục' }).first()).toBeVisible();
    await shellWindow!.keyboard.press('Escape');

    const offenders: string[] = [];
    await shellWindow!.getByRole('button', { name: 'Mở Tổng quan Editor' }).click();
    await shellWindow!.waitForTimeout(700);
    await expect(shellWindow!.locator('main, .app-main').first()).not.toContainText('tối đa bốn danh sách');
    offenders.push(...(await longVisibleTexts()).map((text) => `Tổng quan: ${text}`));
    for (const page of ['Tải danh sách', 'Ghép theo Timeline', 'Hàng đợi', 'Lịch sử', 'Tải 1 video', 'Xem trước & Cắt', 'Ghép & Xuất', 'Lọc video theo link', 'Dọn dẹp máy', 'Cập nhật', 'Công cụ', 'Chẩn đoán', 'Nhật ký', 'Giới thiệu']) {
      await goTo(page);
      offenders.push(...(await longVisibleTexts()).map((text) => `${page}: ${text}`));
    }
    await goTo('Cài đặt');
    for (const section of ['Chung', 'Hiệu năng', 'Tải danh sách', 'Tải & Ghép', 'Lưu trữ', 'Kiểm tra', 'Cập nhật']) {
      await shellWindow!.locator('main, .app-main').first().getByRole('button', { name: section, exact: true }).first().click();
      await shellWindow!.waitForTimeout(400);
      offenders.push(...(await longVisibleTexts()).map((text) => `Cài đặt/${section}: ${text}`));
    }
    expect(offenders, `Chữ dài cố định còn sót:\n${offenders.join('\n')}`).toEqual([]);

    // ⓘ: câu đầy đủ chỉ hiện khi rê chuột.
    const hint = shellWindow!.locator('.info-hint').first();
    await expect(hint).toBeVisible();
    await shellWindow!.mouse.move(2, 2);
    await expect(hint.locator('.info-hint-tip')).toBeHidden();
    await hint.hover();
    await expect(hint.locator('.info-hint-tip')).toBeVisible();
    expect((await hint.getAttribute('aria-label'))?.length ?? 0).toBeGreaterThan(20);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Phần C rà soát giao diện (người dùng duyệt 2026-10-06): nút "Áp dụng thư mục tạm cho tất cả danh sách" — CHỈ ô thư mục
 * tạm, phạm vi theo từng trang, hộp xác nhận liệt kê từng danh sách, bỏ qua danh sách đang chạy/tạm dừng, có ô "Đặt làm
 * mặc định cho danh sách mới". Đường dẫn đều nằm trong thư mục tạm của bài kiểm (không đụng thư mục thật).
 */
test('Phần C: áp dụng thư mục tạm cho tất cả danh sách — xác nhận, bỏ qua danh sách đang chạy, không đụng trang khác', async () => {
  test.setTimeout(120_000);
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-apply-temp-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    await shellWindow.setViewportSize({ width: 1400, height: 900 });
  };
  const goTo = async (label: string): Promise<void> => {
    await shellWindow!.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('button', { name: label, exact: true }).click();
    await shellWindow!.waitForTimeout(800);
  };
  const tab = (name: string): ReturnType<Page['locator']> => shellWindow!.locator('.workflow-tab', { hasText: name });
  const sharedTemp = path.join(sandbox, 'tam-chung');

  try {
    await launch();
    await closeElectronApplication();
    const now = new Date().toISOString();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    const insertProject = db.prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,aspect_ratio,created_at,updated_at,archived_at)
       VALUES(?,?,?,'','draft',?,?,?,?,'x','quality-source-size','resource-balanced',0,'original',?,?,NULL)`
    );
    const ids: string[] = [];
    for (const lane of [1, 2, 3]) {
      const id = randomUUID();
      ids.push(id);
      const output = path.join(sandbox, `video-${lane}`);
      insertProject.run(id, `Danh sách tải ${lane}`, `__WORKBENCH_DOWNLOAD_${lane}__`, output, path.join(sandbox, `tam-${lane}`), output, path.join(sandbox, 'q'), now, now);
    }
    // Một quy trình ghép ĐÃ CÓ (đã lưu) — phải giữ nguyên thư mục xử lý tạm (phạm vi theo từng trang).
    const mergeOutput = path.join(sandbox, 'ghep-1');
    insertProject.run(randomUUID(), 'Quy trình ghép e2e', '__WORKBENCH_MERGE_1__', mergeOutput, path.join(sandbox, 'tam-ghep-1'), mergeOutput, path.join(sandbox, 'q'), now, now);
    // Danh sách 3 đang tạm dừng → ô thư mục bị khóa → phải được bỏ qua.
    db.prepare(
      `INSERT INTO queue_jobs(id,project_id,type,status,priority,input_json,progress,attempts,max_attempts,error_code,error_message,created_at,updated_at)
       VALUES(?,?,'download','paused',0,?,0,0,3,NULL,NULL,?,?)`
    ).run(randomUUID(), ids[2]!, JSON.stringify({ url: 'https://example.com/video' }), now, now);
    const appRow = db.prepare("SELECT value_json FROM app_settings WHERE key='app'").get() as { value_json: string };
    db.prepare("UPDATE app_settings SET value_json=? WHERE key='app'").run(JSON.stringify({ ...JSON.parse(appRow.value_json), downloadLaneCount: 3 }));
    db.close();

    await launch();
    // Hộp "Có N tác vụ chưa xong" (Đợt 1) có thể hiện vì danh sách 3 đang tạm dừng — chọn Để sau.
    const later = shellWindow!.getByRole('button', { name: 'Để sau' });
    if (await later.isVisible({ timeout: 3_000 }).catch(() => false)) await later.click();

    await goTo('Ghép theo Timeline');
    const mergeTempBefore = await shellWindow!.locator('.compact-config-temp input').first().inputValue();
    expect(mergeTempBefore, 'quy trình ghép đã lưu nạp đúng thư mục tạm của nó').toBe(path.join(sandbox, 'tam-ghep-1'));

    await goTo('Tải danh sách');
    await expect(tab('Danh sách tải 3')).toBeVisible({ timeout: 15_000 });
    await tab('Danh sách tải 2').click();
    const laneTwoOutput = await shellWindow!.locator('.compact-config-output input').first().inputValue();
    await tab('Danh sách tải 3').click();
    const laneThreeTemp = await shellWindow!.locator('.compact-config-temp input').first().inputValue();

    const readDefaultTemp = async (): Promise<string> =>
      shellWindow!.evaluate(async () => {
        const desktop = (window as unknown as { desktop: { settings: { get: () => Promise<{ defaultTempFolder: string }> } } }).desktop;
        return (await desktop.settings.get()).defaultTempFolder;
      });
    const settingsDefaultBefore = await readDefaultTemp();

    await tab('Danh sách tải 1').click();
    await shellWindow!.locator('.compact-config-temp input').first().fill(sharedTemp);
    // Ô thư mục lưu video KHÔNG có nút áp dụng cho tất cả; ô thư mục tạm có.
    expect(await shellWindow!.locator('.compact-config-output .folder-apply-all').count()).toBe(0);
    await shellWindow!.locator('.compact-config-temp .folder-apply-all').first().click();

    const dialog = shellWindow!.getByRole('dialog', { name: 'Áp dụng thư mục tạm cho tất cả danh sách?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Danh sách tải 2: ${path.join(sandbox, 'tam-2')} → ${sharedTemp}`);
    await expect(dialog).toContainText('Danh sách tải 3: bỏ qua — đang chạy hoặc tạm dừng');
    await dialog.getByRole('checkbox', { name: 'Đặt làm mặc định cho danh sách mới' }).check();
    await dialog.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(dialog).toBeHidden();

    await tab('Danh sách tải 2').click();
    await expect(shellWindow!.locator('.compact-config-temp input').first()).toHaveValue(sharedTemp);
    await expect(shellWindow!.locator('.compact-config-output input').first()).toHaveValue(laneTwoOutput);
    await tab('Danh sách tải 3').click();
    await expect(shellWindow!.locator('.compact-config-temp input').first()).toHaveValue(laneThreeTemp);
    // Người dùng chọn (2026-10-08): mặc định RIÊNG từng trang — "Thư mục tạm mặc định" chung trong Cài đặt KHÔNG đổi.
    expect(await readDefaultTemp(), 'không đụng cài đặt chung').toBe(settingsDefaultBefore);
    // Sửa riêng danh sách 1 sang thư mục khác (thư mục "dùng gần nhất" đổi theo) — danh sách MỚI vẫn nhận đúng mặc định đã đặt.
    await tab('Danh sách tải 1').click();
    await shellWindow!.locator('.compact-config-temp input').first().fill(path.join(sandbox, 'tam-rieng'));
    await shellWindow!.getByRole('button', { name: /Thêm danh sách/ }).click();
    await expect(tab('Danh sách tải 4')).toBeVisible({ timeout: 10_000 });
    await tab('Danh sách tải 4').click();
    await expect(shellWindow!.locator('.compact-config-temp input').first()).toHaveValue(sharedTemp);

    // Phạm vi theo từng trang: quy trình ghép ĐÃ CÓ không bị đụng, quy trình MỚI không nhận mặc định của Tải danh sách.
    await goTo('Ghép theo Timeline');
    await expect(shellWindow!.locator('.compact-config-temp input').first()).toHaveValue(mergeTempBefore);
    expect(mergeTempBefore).not.toBe(sharedTemp);
    await shellWindow!.getByRole('button', { name: /Thêm quy trình/ }).click();
    await shellWindow!.waitForTimeout(800);
    const mergeTemps = await shellWindow!.locator('.workflow-tab').count();
    await shellWindow!.locator('.workflow-tab').nth(mergeTemps - 1).click();
    await expect(shellWindow!.locator('.compact-config-temp input').first()).not.toHaveValue(sharedTemp);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Đợt 3 mục 7 (rà soát bản cài 1.5.0): lọc mức "Lỗi" sót phần lớn lỗi — trang chỉ tải 2000 dòng MỚI NHẤT rồi lọc trên giao
 * diện, nên khi nhật ký gỡ lỗi dồn nhiều (máy thật: 51.604 dòng debug), lỗi cũ hơn bị đẩy ra ngoài (lọc ra 71/172 lỗi).
 * Dựng 150 lỗi cũ + 2500 dòng gỡ lỗi mới hơn; chọn mức "Lỗi" phải thấy đủ 150. Kèm: ô "Thành phần" lọc được bằng tên tiếng
 * Việt như gợi ý trong ô.
 */
test('Đợt 3 mục 7: lọc nhật ký theo mức ở CSDL — đủ lỗi cũ dù có hàng nghìn dòng gỡ lỗi mới hơn', async () => {
  test.setTimeout(120_000);
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-log-level-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
  };

  try {
    await launch();
    await closeElectronApplication();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    const insertLog = db.prepare(
      'INSERT INTO event_logs(id,timestamp,level,module,project_id,job_id,attempt_id,event_code,message,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
    );
    const base = Date.now() - 2 * 24 * 60 * 60 * 1000;
    db.exec('BEGIN');
    for (let index = 0; index < 150; index += 1) {
      insertLog.run(randomUUID(), new Date(base + index * 1000).toISOString(), 'error', 'download', null, null, null, 'E2E_OLD_ERROR', `Lỗi cũ số ${index}`, null);
    }
    for (let index = 0; index < 2500; index += 1) {
      insertLog.run(randomUUID(), new Date(base + 3_600_000 + index * 1000).toISOString(), 'debug', 'queue', null, null, null, 'E2E_DEBUG', `Gỡ lỗi số ${index}`, null);
    }
    db.exec('COMMIT');
    db.close();

    await launch();
    await shellWindow!
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('button', { name: 'Nhật ký', exact: true })
      .click();
    await shellWindow!.locator('label', { hasText: 'Mức' }).locator('select').selectOption('error');
    await expect
      .poll(async () => shellWindow!.locator('.logs-data-table tbody tr', { hasText: 'Lỗi cũ số' }).count(), { timeout: 15_000 })
      .toBe(150);

    // Ô "Thành phần" lọc được bằng tên tiếng Việt như gợi ý trong ô (trước đây chỉ khớp mã nội bộ "download").
    await shellWindow!.locator('label', { hasText: 'Mức' }).locator('select').selectOption('all');
    await shellWindow!.locator('label', { hasText: 'Thành phần' }).locator('input').fill('tải xuống');
    await expect
      .poll(async () => shellWindow!.locator('.logs-data-table tbody tr', { hasText: 'Lỗi cũ số' }).count(), { timeout: 15_000 })
      .toBe(150);
    expect(await shellWindow!.locator('.logs-data-table tbody tr', { hasText: 'Gỡ lỗi số' }).count()).toBe(0);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Đợt 3 mục 8 (rà soát bản cài 1.5.0): "toast chỉ hiện cho sự kiện mới phát sinh, không hiện lại lỗi cũ khi tải lịch sử".
 * Mô phỏng mở lại app ngay sau một lỗi cấp ứng dụng của phiên trước (dòng lỗi còn "mới" theo giờ): lúc mở app và khi mở
 * trang Nhật ký, lịch sử được nạp — khung chẩn đoán không được bật lại lỗi cũ đó.
 */
test('Đợt 3 mục 8: lỗi cũ nạp từ lịch sử không bật lại thông báo chẩn đoán', async () => {
  test.setTimeout(120_000);
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-old-toast-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
  };

  try {
    await launch();
    await closeElectronApplication();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    // Giờ ghi lùi về sau vài giây: suốt lúc mở app dòng lỗi vẫn "dưới 12 giây" — đúng trường hợp quy tắc theo giờ bỏ lọt.
    db.prepare(
      'INSERT INTO event_logs(id,timestamp,level,module,project_id,job_id,attempt_id,event_code,message,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).run(randomUUID(), new Date(Date.now() + 6_000).toISOString(), 'error', 'app', null, null, null, 'E2E_OLD_APP_ERROR', 'Lỗi cũ của phiên trước', null);
    db.close();

    await launch();
    await shellWindow!.waitForTimeout(2_500);
    expect(await shellWindow!.locator('.diagnostic-dock').count(), 'mở app: không bật lại lỗi cũ').toBe(0);

    await shellWindow!
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('button', { name: 'Nhật ký', exact: true })
      .click();
    await expect(shellWindow!.locator('.logs-data-table tbody tr', { hasText: 'Lỗi cũ của phiên trước' })).toHaveCount(1, {
      timeout: 15_000
    });
    await shellWindow!.waitForTimeout(1_000);
    expect(await shellWindow!.locator('.diagnostic-dock').count(), 'tải lịch sử: không bật lại lỗi cũ').toBe(0);

    // Sự kiện MỚI phát sinh vẫn hiện và đóng được.
    await electronApplication!.evaluate(
      ({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0]!.webContents.send('events:log', data),
      { id: randomUUID(), timestamp: new Date().toISOString(), level: 'error', module: 'tools', eventCode: 'TOOL_HEALTH_CHECK_FAILED', message: 'Công cụ lỗi mới' }
    );
    await expect(shellWindow!.locator('.diagnostic-dock')).toBeVisible({ timeout: 5_000 });
    await shellWindow!.locator('.diagnostic-dock').getByRole('button', { name: 'Đóng thông báo này' }).click();
    await expect(shellWindow!.locator('.diagnostic-dock')).toHaveCount(0);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Đợt 3 mục 9 (rà soát bản cài 1.5.0): xóa nhật ký phải hỏi xác nhận trong giao diện — trước đây bấm là xóa ngay, không hoàn
 * tác được. Cả 3 nơi: trang Nhật ký, icon "Xóa nhật ký" của danh sách tải, của quy trình ghép. Bấm "Quay lại" → còn nguyên.
 */
test('Đợt 3 mục 9: xóa nhật ký hỏi xác nhận — trang Nhật ký, danh sách tải, quy trình ghép', async () => {
  test.setTimeout(150_000);
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-clear-logs-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    await shellWindow.setViewportSize({ width: 1400, height: 900 });
  };
  const goTo = async (label: string): Promise<void> => {
    await shellWindow!.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('button', { name: label, exact: true }).click();
    await shellWindow!.waitForTimeout(800);
  };
  // Đếm các dòng ĐÃ GHI SẴN (mã E2E) — sau khi xóa, ứng dụng tự ghi một dòng "đã dọn sạch" (PROJECT_LOGS_CLEARED), không tính.
  const countLogs = async (projectId?: string): Promise<number> =>
    shellWindow!.evaluate(async (id) => {
      const desktop = (window as unknown as { desktop: { logs: { list: (query: Record<string, unknown>) => Promise<Array<{ eventCode: string }>> } } }).desktop;
      return (await desktop.logs.list({ ...(id ? { projectId: id } : {}), limit: 5000 })).filter((entry) => entry.eventCode === 'E2E').length;
    }, projectId);

  try {
    await launch();
    await closeElectronApplication();
    const now = new Date().toISOString();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    const insertProject = db.prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,aspect_ratio,created_at,updated_at,archived_at)
       VALUES(?,?,?,'','draft',?,?,?,?,'x','quality-source-size','resource-balanced',0,'original',?,?,NULL)`
    );
    const downloadId = randomUUID();
    const mergeId = randomUUID();
    insertProject.run(downloadId, 'Danh sách tải 1', '__WORKBENCH_DOWNLOAD_1__', path.join(sandbox, 'v1'), path.join(sandbox, 't1'), path.join(sandbox, 'v1'), path.join(sandbox, 'q'), now, now);
    insertProject.run(mergeId, 'Quy trình ghép 1', '__WORKBENCH_MERGE_1__', path.join(sandbox, 'g1'), path.join(sandbox, 'tg1'), path.join(sandbox, 'g1'), path.join(sandbox, 'q'), now, now);
    const insertLog = db.prepare(
      'INSERT INTO event_logs(id,timestamp,level,module,project_id,job_id,attempt_id,event_code,message,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
    );
    for (let index = 0; index < 5; index += 1) {
      insertLog.run(randomUUID(), now, 'info', 'download', downloadId, null, null, 'E2E', `tải ${index}`, null);
      insertLog.run(randomUUID(), now, 'info', 'merge', mergeId, null, null, 'E2E', `ghép ${index}`, null);
      insertLog.run(randomUUID(), now, 'info', 'app', null, null, null, 'E2E', `chung ${index}`, null);
    }
    db.close();
    await launch();

    // 1) Danh sách tải: hỏi; Quay lại → còn; Xóa → hết.
    await goTo('Tải danh sách');
    await shellWindow!.getByRole('button', { name: 'Xóa nhật ký' }).first().click();
    const laneDialog = shellWindow!.getByRole('dialog', { name: /Xóa nhật ký danh sách tải 1\?/ });
    await expect(laneDialog).toBeVisible({ timeout: 5_000 });
    await laneDialog.getByRole('button', { name: 'Quay lại' }).click();
    await expect(laneDialog).toBeHidden();
    expect(await countLogs(downloadId), 'Quay lại: nhật ký danh sách tải còn nguyên').toBe(5);
    await shellWindow!.getByRole('button', { name: 'Xóa nhật ký' }).first().click();
    await laneDialog.getByRole('button', { name: 'Xóa nhật ký' }).click();
    await expect.poll(async () => countLogs(downloadId), { timeout: 10_000 }).toBe(0);
    expect(await countLogs(mergeId), 'không đụng quy trình ghép').toBe(5);

    // 2) Quy trình ghép.
    await goTo('Ghép theo Timeline');
    await shellWindow!.getByRole('button', { name: 'Xóa nhật ký' }).first().click();
    const mergeDialog = shellWindow!.getByRole('dialog', { name: /Xóa nhật ký quy trình ghép 1\?/ });
    await expect(mergeDialog).toBeVisible({ timeout: 5_000 });
    await mergeDialog.getByRole('button', { name: 'Quay lại' }).click();
    expect(await countLogs(mergeId), 'Quay lại: nhật ký quy trình ghép còn nguyên').toBe(5);
    await shellWindow!.getByRole('button', { name: 'Xóa nhật ký' }).first().click();
    await mergeDialog.getByRole('button', { name: 'Xóa nhật ký' }).click();
    await expect.poll(async () => countLogs(mergeId), { timeout: 10_000 }).toBe(0);

    // 3) Trang Nhật ký: xóa toàn bộ.
    await goTo('Nhật ký');
    const before = await countLogs();
    expect(before, 'còn 5 dòng chung').toBe(5);
    await shellWindow!.getByRole('button', { name: 'Xóa toàn bộ nhật ký' }).click();
    const allDialog = shellWindow!.getByRole('dialog', { name: /Xóa toàn bộ nhật ký\?/ });
    await expect(allDialog).toBeVisible({ timeout: 5_000 });
    await expect(allDialog).toContainText('không thể hoàn tác');
    await allDialog.getByRole('button', { name: 'Quay lại' }).click();
    expect(await countLogs(), 'Quay lại: nhật ký còn nguyên').toBe(5);
    await shellWindow!.getByRole('button', { name: 'Xóa toàn bộ nhật ký' }).click();
    await allDialog.getByRole('button', { name: 'Xóa nhật ký' }).click();
    await expect(allDialog).toBeHidden();
    await expect.poll(async () => countLogs(), { timeout: 10_000 }).toBe(0);
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/**
 * Khám phá #12 (bản cài 1.5.0, 2026-10-05) — mục cuối Đợt 3: khung "Nhật ký riêng" của danh sách chỉ đọc CSDL khi MỞ khung,
 * nên số "N sự kiện" trên đầu khung lúc đóng chỉ đếm dòng tình cờ có trong bộ nhớ chung (100 dòng mới nhất của cả app lúc
 * mở + dòng mới phát sinh); và sau khi xóa nhật ký, dòng đã đọc vẫn nằm trong khung. Cả Tải danh sách lẫn Ghép theo Timeline.
 */
test('Khám phá #12: Nhật ký riêng của danh sách đọc lịch sử ngay, đếm đúng, xóa xong không còn dòng cũ', async () => {
  test.setTimeout(150_000);
  const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'tubmedia-e2e-lane-logs-'));
  const userDataDirectory = path.join(sandbox, 'userdata');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    NODE_ENV: 'test',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userDataDirectory,
    PLAYWRIGHT_TEST: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  const launch = async (): Promise<void> => {
    electronApplication = await electron.launch({ args: [mainEntry], cwd: projectRoot, env, timeout: 45_000 });
    mainProcessId = electronApplication.process().pid;
    shellWindow = await electronApplication.firstWindow({ timeout: 30_000 });
    await shellWindow.waitForSelector('.app-sidebar', { timeout: 30_000 });
    await shellWindow.setViewportSize({ width: 1400, height: 900 });
  };
  const goTo = async (label: string): Promise<void> => {
    await shellWindow!.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('button', { name: label, exact: true }).click();
    await shellWindow!.waitForTimeout(800);
  };

  try {
    await launch();
    await closeElectronApplication();
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date().toISOString();
    const db = new DatabaseSync(path.join(userDataDirectory, 'database', 'studio.sqlite'));
    const insertProject = db.prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,aspect_ratio,created_at,updated_at,archived_at)
       VALUES(?,?,?,'','draft',?,?,?,?,'x','quality-source-size','resource-balanced',0,'original',?,?,NULL)`
    );
    const downloadId = randomUUID();
    const mergeId = randomUUID();
    insertProject.run(downloadId, 'Danh sách tải 1', '__WORKBENCH_DOWNLOAD_1__', path.join(sandbox, 'v1'), path.join(sandbox, 't1'), path.join(sandbox, 'v1'), path.join(sandbox, 'q'), now, now);
    insertProject.run(mergeId, 'Quy trình ghép 1', '__WORKBENCH_MERGE_1__', path.join(sandbox, 'g1'), path.join(sandbox, 'tg1'), path.join(sandbox, 'g1'), path.join(sandbox, 'q'), now, now);
    const insertLog = db.prepare(
      'INSERT INTO event_logs(id,timestamp,level,module,project_id,job_id,attempt_id,event_code,message,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
    );
    db.exec('BEGIN');
    // Lịch sử CŨ của từng danh sách (hôm qua) + 300 dòng chung MỚI hơn → không lọt vào 100 dòng nạp sẵn lúc mở app.
    for (let index = 0; index < 7; index += 1) {
      const at = new Date(old.getTime() + index * 1000).toISOString();
      insertLog.run(randomUUID(), at, 'info', 'download', downloadId, null, null, 'E2E', `Lịch sử tải ${index}`, null);
      insertLog.run(randomUUID(), at, 'info', 'merge', mergeId, null, null, 'E2E', `Lịch sử ghép ${index}`, null);
    }
    for (let index = 0; index < 300; index += 1) {
      insertLog.run(randomUUID(), new Date(Date.now() - 60_000 + index).toISOString(), 'debug', 'queue', null, null, null, 'E2E_NOISE', `chung ${index}`, null);
    }
    db.exec('COMMIT');
    db.close();
    await launch();

    for (const [page, toggleName, rowText] of [
      ['Tải danh sách', /Nhật ký riêng/, 'Lịch sử tải'],
      ['Ghép theo Timeline', /Nhật ký riêng của quy trình/, 'Lịch sử ghép']
    ] as const) {
      await goTo(page);
      const toggle = shellWindow!.locator('.lane-log-toggle').filter({ hasText: toggleName }).first();
      // Khung còn ĐÓNG: số sự kiện đã đúng.
      await expect(toggle, `${page}: đếm đúng khi khung đóng`).toContainText('7 sự kiện', { timeout: 10_000 });
      await toggle.click();
      await expect(shellWindow!.locator('.lane-log-body').first().getByText(rowText)).toHaveCount(7, { timeout: 10_000 });

      // Xóa nhật ký (hộp xác nhận của mục 9) → khung không còn dòng cũ.
      await shellWindow!.getByRole('button', { name: 'Xóa nhật ký' }).first().click();
      await shellWindow!.getByRole('dialog').getByRole('button', { name: 'Xóa nhật ký' }).click();
      await expect(shellWindow!.locator('.lane-log-body').first().getByText(rowText), `${page}: xóa xong không còn dòng cũ`).toHaveCount(0, {
        timeout: 10_000
      });
      await expect(toggle).not.toContainText('7 sự kiện');
    }
  } finally {
    await closeElectronApplication();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
