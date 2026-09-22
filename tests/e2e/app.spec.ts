/// <reference lib="dom" />
// Chỉ tệp này cần kiểu DOM (page.evaluate chạy trong ngữ cảnh trình duyệt của cửa sổ Electron) —
// tham chiếu ba gạch chéo chỉ áp dụng cho tệp này, không đổi "lib" chung của tsconfig.node.json
// (giữ nguyên cho code tiến trình chính không có DOM).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
