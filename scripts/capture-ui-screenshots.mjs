// Chụp ảnh giao diện Tubmedia để so sánh trước/sau khi thiết kế lại.
//
//   npx electron-vite build
//   node scripts/capture-ui-screenshots.mjs --label truoc
//   node scripts/capture-ui-screenshots.mjs --label sau
//
// AN TOÀN: chạy Electron thật với dữ liệu TÁCH BIỆT trong thư mục tạm (TUBMEDIA_E2E_USER_DATA),
// chặn hộp thoại/mở thư mục/clipboard/tự khởi động, không tải công cụ (dùng sẵn công cụ đã có),
// không mạng cập nhật, không đụng cookie hay tài khoản. Chỉ bấm chuyển trang, không thực hiện tác vụ nào.
// Ảnh lưu NGOÀI repo: <out>/<label>/<trạng-thái>/<kích-thước>/<sáng|tối>/<số>-<trang>.png
/* global window, document -- chạy bên trong trang qua page.evaluate */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { _electron as electron } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const projectRoot = resolve(process.cwd());
const label = option('label', 'truoc');
const outRoot = resolve(option('out', join(homedir(), 'Tubmedia-anh-so-sanh')));
const sizes = option('sizes', '1440x900,920x640').split(',');
const themes = option('themes', 'toi,sang').split(',');
const onlyPages = option('pages', '')
  .split(',')
  .filter(Boolean);
const explicitToolsDirectory = option('tools', '');

const PAGES = [
  ['editor-home', 'tong-quan'],
  ['download-workbench', 'tai-xuong'],
  ['filter-by-links', 'loc-theo-link'],
  ['download-merge', 'tai-va-ghep'],
  ['activity', 'hang-doi'],
  ['history', 'lich-su'],
  ['diagnostics', 'chan-doan'],
  ['tools', 'cong-cu'],
  ['cleanup', 'don-dep'],
  ['updates', 'cap-nhat'],
  ['logs', 'nhat-ky'],
  ['settings', 'cai-dat'],
  ['about', 'gioi-thieu']
].filter(([id]) => onlyPages.length === 0 || onlyPages.includes(id));

function fail(message) {
  console.error(`LỖI: ${message}`);
  process.exit(1);
}

function resolveToolsDirectory() {
  const needed = ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe'];
  const candidates = [
    explicitToolsDirectory,
    join(projectRoot, 'tool'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Download video Tubmedia', 'resources', 'tool')
  ].filter(Boolean);
  for (const directory of candidates) {
    if (needed.every((name) => existsSync(join(directory, name)))) return directory;
  }
  return null;
}

if (!existsSync(join(projectRoot, 'out', 'main', 'index.js'))) {
  fail('Chưa có thư mục out/. Hãy chạy trước: npx electron-vite build');
}
const toolsDirectory = resolveToolsDirectory();
if (!toolsDirectory) {
  fail(
    'Không tìm thấy yt-dlp.exe, ffmpeg.exe, ffprobe.exe. Kịch bản từ chối chạy để app KHÔNG tự tải công cụ. Dùng --tools <thư mục>.'
  );
}

const sandbox = mkdtempSync(join(tmpdir(), 'tubmedia-shot-'));
const userData = join(sandbox, 'userdata');
const folders = {
  source: join(sandbox, 'nguon'),
  temp: join(sandbox, 'tam'),
  output: join(sandbox, 'thanh-pham')
};
for (const folder of Object.values(folders)) mkdirSync(folder, { recursive: true });
mkdirSync(join(userData, 'database'), { recursive: true });
const databasePath = join(userData, 'database', 'studio.sqlite');

const settings = {
  theme: 'dark',
  startWithWindows: false,
  autoCheckAppUpdates: false,
  autoCheckToolUpdates: false,
  defaultSourceFolder: folders.source,
  defaultTempFolder: folders.temp,
  defaultOutputFolder: folders.output,
  ytdlpPath: join(toolsDirectory, 'yt-dlp.exe'),
  ffmpegPath: join(toolsDirectory, 'ffmpeg.exe'),
  ffprobePath: join(toolsDirectory, 'ffprobe.exe'),
  aria2cPath: existsSync(join(toolsDirectory, 'aria2c.exe')) ? join(toolsDirectory, 'aria2c.exe') : ''
};

function seedSettings() {
  const db = new DatabaseSync(databasePath);
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run('app', JSON.stringify(settings), new Date().toISOString());
  db.close();
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// Chỉ chèn trạng thái KẾT THÚC hoặc tạm dừng: không có việc "pending" nào tự chạy khi app mở.
function seedWorkData() {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  const projectId = 'shot-project-1';
  db.prepare(
    `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    projectId,
    'Dự án mẫu — Phóng sự tháng 9',
    'PS-09',
    'Dữ liệu giả để chụp ảnh giao diện.',
    'active',
    folders.source,
    folders.temp,
    folders.output,
    join(folders.temp, '_cach-ly'),
    'Phong su thang 9',
    'quality-source-size',
    'resource-interactive',
    minutesAgo(300),
    minutesAgo(5)
  );
  const jobs = [
    ['completed', 'download', 100, 'Phỏng vấn nhân vật — bản đầy đủ', 'https://example.invalid/watch?v=demo1', null, null, 240],
    ['completed', 'download', 100, 'Toàn cảnh thành phố lúc bình minh', 'https://example.invalid/watch?v=demo2', null, null, 200],
    ['completed', 'merge', 100, 'Phong su thang 9', '', null, null, 120],
    ['failed', 'download', 37, 'Clip hiện trường (bị chặn khu vực)', 'https://example.invalid/watch?v=demo3', 'DOWNLOAD_FAILED', 'Video không khả dụng ở khu vực của bạn.', 90],
    ['cancelled', 'download', 12, 'Nhạc nền không bản quyền', 'https://example.invalid/watch?v=demo4', null, null, 60],
    ['skipped', 'download', 100, 'Video đã bị xóa khỏi nền tảng', 'https://example.invalid/watch?v=demo5', null, null, 55],
    ['interrupted', 'download', 64, 'Bản ghi phỏng vấn số 4', 'https://example.invalid/watch?v=demo7', 'APP_RESTARTED', 'Ứng dụng đóng khi tác vụ đang chạy.', 40],
    ['paused', 'download', 51, 'Bản ghi hội nghị 2 giờ', 'https://example.invalid/watch?v=demo6', null, null, 20]
  ];
  const insert = db.prepare(
    `INSERT INTO queue_jobs(id,project_id,type,status,priority,input_json,progress,attempts,max_attempts,error_code,error_message,created_at,updated_at,started_at,finished_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  jobs.forEach(([status, type, progress, name, url, code, message, ago], index) => {
    const finished = ['completed', 'failed', 'cancelled', 'skipped', 'interrupted'].includes(status);
    insert.run(
      `shot-job-${index + 1}`,
      projectId,
      type,
      status,
      0,
      JSON.stringify({
        displayName: name,
        url,
        outputPath: join(folders.output, `${name}.mp4`),
        title: name
      }),
      progress,
      status === 'failed' ? 3 : 1,
      3,
      code,
      message,
      minutesAgo(ago + 10),
      minutesAgo(ago),
      minutesAgo(ago + 9),
      finished ? minutesAgo(ago) : null
    );
  });
  db.close();
}

const notificationSeed = () => {
  const now = Date.now();
  const at = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const item = (id, severity, title, message, minutes, extra = {}) => ({
    id,
    severity,
    title,
    message,
    createdAt: at(minutes),
    updatedAt: at(minutes),
    count: 1,
    pinned: false,
    ...extra
  });
  return [
    item('shot-n1', 'error', 'Ổ đĩa không đủ dung lượng', 'Tubmedia đã tạm dừng tác vụ trước khi đầy ổ đĩa.', 3, { code: 'DISK_FULL', sticky: true }),
    item('shot-n2', 'warning', 'Cần thêm Cookies', 'Nguồn này yêu cầu đăng nhập để xem.', 12, { code: 'AUTHENTICATION_REQUIRED' }),
    item('shot-n3', 'info', 'Đã có Tubmedia mới', 'Một phiên bản mới hơn đang có sẵn.', 45, { code: 'APP_UPDATE_AVAILABLE' }),
    item('shot-n4', 'success', 'Đã hoàn tất 3 video', 'Các video đã được kiểm tra và lưu vào thư mục thành phẩm.', 90, { readAt: at(80) })
  ];
};

const shots = [];

async function launch() {
  const application = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      TUBMEDIA_E2E: '1',
      TUBMEDIA_E2E_USER_DATA: userData,
      ELECTRON_ENABLE_LOGGING: '0'
    }
  });
  const pid = application.process().pid;
  await application.evaluate(({ dialog, shell, clipboard, app }) => {
    const cancelled = () => Promise.resolve({ canceled: true, filePaths: [], response: 0 });
    dialog.showOpenDialog = cancelled;
    dialog.showSaveDialog = cancelled;
    dialog.showMessageBox = cancelled;
    dialog.showMessageBoxSync = () => 0;
    dialog.showErrorBox = () => undefined;
    shell.openPath = () => Promise.resolve('');
    shell.showItemInFolder = () => undefined;
    shell.openExternal = () => Promise.resolve();
    clipboard.writeText = () => undefined;
    app.setLoginItemSettings = () => undefined;
  });
  const page = await application.firstWindow();
  await page.waitForSelector('.app-sidebar', { timeout: 60_000 });
  await page.evaluate(() => {
    window.confirm = () => false;
    window.prompt = () => null;
  });
  return { application, page, pid };
}

function killTree(pid) {
  if (!pid) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
}

async function closeApp(handle) {
  try {
    await Promise.race([
      handle.application.evaluate(({ app }) => {
        app.removeAllListeners('window-all-closed');
        app.exit(0);
      }),
      sleep(4_000)
    ]);
  } catch {
    // Electron thường đóng kết nối ngay khi thoát.
  }
  await Promise.race([handle.application.close().catch(() => undefined), sleep(4_000)]);
  killTree(handle.pid);
}

async function setSize(handle, size) {
  const [width, height] = size.split('x').map(Number);
  await handle.application.evaluate(
    ({ BrowserWindow }, dimensions) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window?.isMaximized()) window.unmaximize();
      window?.setContentSize(dimensions.width, dimensions.height);
    },
    { width, height }
  );
  await sleep(500);
}

async function applyTheme(page, theme) {
  await page.evaluate((light) => {
    document.documentElement.classList.toggle('light', light);
  }, theme === 'sang');
  await sleep(150);
}

// Đóng mọi thông báo nổi/khung chẩn đoán để chúng không che trang đang chụp.
async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const close = page.locator('button[aria-label="Đóng thông báo"], button[aria-label="Đóng thông báo này"]');
    if (!(await close.count())) return;
    try {
      await close.first().click({ timeout: 1_500 });
    } catch {
      return;
    }
    await sleep(450);
  }
}

async function gotoPage(page, id) {
  const selector = `[data-page-id="${id}"]`;
  if (!(await page.locator(selector).count())) return false;
  await page.locator(selector).click();
  await sleep(900);
  return true;
}

async function capturePass(handle, state, withOverlays) {
  // Ảnh các thông báo nổi ngay khi mở app (trước khi đóng) — chỉ chụp một lần cho mỗi trạng thái.
  await setSize(handle, sizes[0]);
  await applyTheme(handle.page, themes[0]);
  await sleep(1_200);
  const startupFile = join(outRoot, label, state, `00-thong-bao-luc-mo-app-${sizes[0]}-${themes[0]}.png`);
  mkdirSync(join(outRoot, label, state), { recursive: true });
  await handle.page.screenshot({ path: startupFile });
  shots.push(startupFile);
  await dismissOverlays(handle.page);
  for (const size of sizes) {
    await setSize(handle, size);
    for (const theme of themes) {
      await applyTheme(handle.page, theme);
      const directory = join(outRoot, label, state, size, theme);
      mkdirSync(directory, { recursive: true });
      let number = 0;
      for (const [id, slug] of PAGES) {
        number += 1;
        if (!(await gotoPage(handle.page, id))) {
          console.warn(`  (bỏ qua) không tìm thấy trang ${id}`);
          continue;
        }
        await dismissOverlays(handle.page);
        const file = join(directory, `${String(number).padStart(2, '0')}-${slug}.png`);
        await handle.page.screenshot({ path: file });
        shots.push(file);
      }
      if (withOverlays) {
        const bell = handle.page.locator('button[aria-label^="Mở Trung tâm thông báo"]');
        if (await bell.count()) {
          await bell.first().click();
          await sleep(700);
          const file = join(directory, `${String(number + 1).padStart(2, '0')}-trung-tam-thong-bao.png`);
          await handle.page.screenshot({ path: file });
          shots.push(file);
          await handle.page.keyboard.press('Escape');
          await sleep(400);
        }
      }
    }
  }
  console.log(`  đã chụp trạng thái "${state}": ${shots.length} ảnh tính đến giờ`);
}

let handle = null;
try {
  console.log(`Chụp ảnh "${label}" vào ${join(outRoot, label)}`);
  console.log(`Thư mục dữ liệu tạm: ${sandbox}`);
  console.log(`Công cụ dùng sẵn (chỉ đọc): ${toolsDirectory}`);

  seedSettings();

  // Lần 1: CSDL rỗng → chụp trạng thái TRỐNG.
  handle = await launch();
  await capturePass(handle, 'trong', false);
  await closeApp(handle);
  handle = null;
  await sleep(1_000);

  // Lần 2: chèn dữ liệu giả → chụp trạng thái CÓ DỮ LIỆU.
  seedWorkData();
  handle = await launch();
  await handle.page.evaluate((records) => {
    window.localStorage.setItem('tubmedia.notification-center.v1', JSON.stringify(records));
  }, notificationSeed());
  await handle.page.reload();
  await handle.page.waitForSelector('.app-sidebar', { timeout: 60_000 });
  await capturePass(handle, 'co-du-lieu', true);
  await closeApp(handle);
  handle = null;
  console.log(`Xong: ${shots.length} ảnh trong ${join(outRoot, label)}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (handle) await closeApp(handle);
  await sleep(500);
  // Chỉ xóa đúng thư mục tạm do chính kịch bản này tạo.
  if (sandbox.startsWith(tmpdir()) && sandbox.includes('tubmedia-shot-')) {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
