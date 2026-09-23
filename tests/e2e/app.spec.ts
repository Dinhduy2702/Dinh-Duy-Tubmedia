/// <reference lib="dom" />
// Chỉ tệp này cần kiểu DOM (page.evaluate chạy trong ngữ cảnh trình duyệt của cửa sổ Electron) —
// tham chiếu ba gạch chéo chỉ áp dụng cho tệp này, không đổi "lib" chung của tsconfig.node.json
// (giữ nguyên cho code tiến trình chính không có DOM).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
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

  electronApplication = await electron.launch({
    args: [mainEntry],
    cwd: projectRoot,
    env: {
      ...cleanEnvironment,
      NODE_ENV: 'test',
      TUBMEDIA_E2E: '1',
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
    const afterCompleteClickStart = Date.now();
    await shellWindow.click('text=Cài đặt', { timeout: 8_000 });
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
