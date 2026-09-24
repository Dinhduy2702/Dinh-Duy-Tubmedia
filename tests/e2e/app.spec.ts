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
