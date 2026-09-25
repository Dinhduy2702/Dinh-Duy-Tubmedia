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
/* global window, document, getComputedStyle, SVGElement, HTMLElement -- chạy bên trong trang qua page.evaluate */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
// --audit: kiểm tra màu trên giao diện THẬT (đỏ ngoài lỗi, tương phản chữ) và ghi audit-mau.json.
const auditColors = args.includes('--audit');
const auditResults = [];
// --gallery: chụp "thư viện mức thông báo" (mẫu dựng bằng ĐÚNG các lớp CSS của thành phần thật) cho cả hai giao diện.
const captureGallery = args.includes('--gallery');
// --card: chụp thẻ "Phát triển bởi" (tĩnh và một khung giữa vệt sáng) ở thanh bên và trang Thông tin, kiểm tra hiệu ứng thật.
const captureCard = args.includes('--card');
// --responsive: chụp lưới 4 cỡ cửa sổ × 3 tỉ lệ hiển thị Windows (đặc tả GĐ 2a, hạng mục B.5),
// tập trung vào trang ① Tải (mới) và Hàng đợi (thanh bên có nhiều mục nhất) thay vì toàn bộ 13+ trang.
const captureResponsive = args.includes('--responsive');
const RESPONSIVE_SIZES = ['920x640', '1280x720', '1920x1080', '2560x1440'];
const RESPONSIVE_SCALES = [100, 125, 150];
const RESPONSIVE_PAGES = [['download-workbench', 'tai-danh-sach'], ['activity', 'hang-doi']];

const PAGES = [
  // Điều chỉnh 2026-09-22: việc CHÍNH hàng ngày thật sự là tải danh sách + ghép theo Timeline (2 trang
  // cũ, logic không đổi) — nay đứng đầu. "Tải 1 video" (①②③) chỉ là tiện ích phụ, xuống nhóm CÔNG CỤ.
  ['download-workbench', 'tai-danh-sach'],
  ['download-merge', 'ghep-theo-timeline'],
  ['activity', 'hang-doi'],
  ['history', 'lich-su'],
  ['step-download', 'buoc-mot-tai'],
  ['step-preview-cut', 'buoc-hai-xem-truoc-cat'],
  ['step-merge-export', 'buoc-ba-ghep-xuat'],
  ['filter-by-links', 'loc-theo-link'],
  ['cleanup', 'don-dep'],
  ['settings', 'cai-dat'],
  ['updates', 'cap-nhat'],
  ['tools', 'cong-cu'],
  ['diagnostics', 'chan-doan'],
  ['logs', 'nhat-ky'],
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

// Mô phỏng tỉ lệ hiển thị Windows (100/125/150%) bằng zoom factor của webContents — cách thực tế để kiểm
// bố cục co giãn theo DPI mà không cần đổi tỉ lệ màn hình thật của máy đang chạy kịch bản.
async function applyScale(handle, percent) {
  await handle.application.evaluate(
    ({ BrowserWindow }, factor) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.webContents.setZoomFactor(factor);
    },
    percent / 100
  );
  await sleep(200);
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

// Chạy trong trang: liệt kê phần tử dùng màu ĐỎ ngoài vùng cho phép và chữ thiếu tương phản.
function auditPageColors() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const parse = (value) => {
    if (!value || value === 'transparent') return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = '#000';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const isRed = (c) => {
    if (!c || c.a < 0.4) return false;
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    if (max < 130 || max - min < 70) return false;
    return c.r === max && c.g < c.r * 0.45 && c.b < c.r * 0.55;
  };
  // Màu của mức LỖI trong bảng màu (chữ, biểu tượng, nút nguy hiểm) là đỏ hợp lệ; chỉ đỏ lạc ngoài bảng màu mới bị báo.
  const rootStyle = getComputedStyle(document.documentElement);
  const errorTokens = ['--tone-error-text', '--tone-error-icon', '--tone-error-border', '--danger-solid'].map((name) => parse(rootStyle.getPropertyValue(name).trim())).filter(Boolean);
  const isErrorToken = (c) => c && errorTokens.some((e) => Math.abs(e.r - c.r) + Math.abs(e.g - c.g) + Math.abs(e.b - c.b) <= 6);
  const strayRed = (value) => { const c = parse(value); return isRed(c) && !isErrorToken(c); };
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
      g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
      b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
      a
    };
  };
  const allowedRed = '.tone-error, [data-tone="error"], .btn-danger, .confirm-danger-button, .tm-logo, .brand-kit-swatch-chip, .btn-delete-lane, .diagnostics-error-list, img, picture';
  const own = (el) => {
    const raw = el.getAttribute('class');
    return el.tagName.toLowerCase() + (raw && raw.trim() ? '.' + raw.trim().split(/\s+/).slice(0, 3).join('.') : '');
  };
  // Với phần tử không có class (svg/path/b...) ghi thêm phần tử cha gần nhất có class để dễ tìm nguồn màu.
  const label = (el) => {
    if (el.getAttribute('class')) return own(el);
    const parent = el.closest('[class]');
    return own(el) + (parent ? ' < ' + own(parent) : '');
  };
  const reds = [];
  const lowContrast = [];
  let textElements = 0;
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    if (!el.closest(allowedRed)) {
      const found = [];
      if (strayRed(style.color) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) found.push('chữ');
      if (strayRed(style.backgroundColor)) found.push('nền');
      if (parseFloat(style.borderTopWidth) > 0 && strayRed(style.borderTopColor)) found.push('viền');
      if (el instanceof SVGElement && (strayRed(style.stroke) || strayRed(style.fill))) found.push('biểu tượng');
      if (found.length) reds.push(label(el) + ' [' + found.join(',') + ']');
    }
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    textElements += 1;
    const fg = parse(style.color);
    if (!fg) continue;
    let background = { r: 0, g: 0, b: 0, a: 0 };
    let unknown = false;
    for (let node = el; node && background.a < 0.999; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage !== 'none' && !s.backgroundImage.includes('url(')) unknown = true;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) background = over(background, c);
      if (unknown && background.a < 0.999) break;
    }
    if (unknown || background.a < 0.999) continue;
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const composed = fg.a < 1 ? over(fg, background) : fg;
    const value = ratio(composed, background);
    if (value < need) lowContrast.push({ el: label(el), ratio: Number(value.toFixed(2)), need, size: Math.round(size), text: el.textContent.trim().slice(0, 30) });
  }
  return { reds, lowContrast, textElements };
}

// Chạy trong trang: dựng bảng mẫu 5 mức (thông báo nổi, khung trong trang, nhãn trạng thái, nút).
function buildToneGallery() {
  const svg = (paths) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const icons = {
    error: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
    warning: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    success: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    neutral: svg('<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>')
  };
  const labels = { error: 'Lỗi', warning: 'Cảnh báo', info: 'Thông tin', success: 'Thành công', neutral: 'Đã ghi nhận' };
  const samples = {
    error: ['Ổ đĩa không đủ dung lượng', 'Tubmedia đã tạm dừng tác vụ trước khi đầy ổ đĩa.'],
    warning: ['Chưa cập nhật được', 'Hãy tạm dừng hoặc hoàn tất mọi tác vụ trước khi cập nhật.'],
    info: ['Đã có Tubmedia mới', 'Chọn Cập nhật ngay để tải và theo dõi tiến độ trong app.'],
    success: ['Đã hoàn tất 3 video', 'Các video đã được kiểm tra và lưu vào thư mục thành phẩm.'],
    neutral: ['Đã hủy thao tác', 'Dữ liệu đã hoàn tất trước đó vẫn được giữ nguyên.']
  };
  const tones = ['error', 'warning', 'info', 'success', 'neutral'];
  const toast = (tone) =>
    '<div class="attention-center tone-' + tone + ' attention-' + tone + ' attention-visible" style="position:relative;left:auto;top:auto;transform:none;width:100%">' +
    '<div class="attention-accent"></div><div class="attention-icon">' + icons[tone] + '</div>' +
    '<div class="attention-copy"><div class="attention-heading"><span class="tone-chip">' + labels[tone] + '</span><div class="text-sm font-black">' + samples[tone][0] + '</div></div>' +
    '<div class="mt-1 text-sm leading-5">' + samples[tone][1] + '</div></div><button class="attention-close" aria-label="Đóng">×</button></div>';
  const notice = (tone) =>
    '<div class="notice tone-' + tone + '"><span class="notice-icon">' + icons[tone] + '</span><div class="notice-body"><div class="notice-head"><span class="tone-chip">' + labels[tone] + '</span><b class="notice-title">' + samples[tone][0] + '</b></div><div>' + samples[tone][1] + '</div></div></div>';
  const badge = (status, tone, text) =>
    '<span class="badge status-badge tone-' + tone + '">' + icons[tone].replace('width="22" height="22"', 'width="13" height="13"') + '<span>' + text + '</span></span>';
  const badges = [['completed','success','Hoàn tất'],['downloading','info','Đang tải'],['merging','info','Đang ghép'],['paused','neutral','Tạm dừng'],['cancelled','neutral','Đã hủy'],['skipped','neutral','Đã bỏ qua'],['pending','neutral','Đang chờ'],['interrupted','warning','Bị gián đoạn'],['failed','error','Có lỗi']];
  const host = document.createElement('div');
  host.id = 'tone-gallery';
  host.style.cssText = 'position:fixed;inset:0;z-index:5000;overflow:auto;padding:24px 32px;background:var(--bg);color:var(--text);display:grid;grid-template-columns:1fr 1fr;gap:20px 32px;align-content:start';
  host.innerHTML =
    '<section><h2 style="margin:0 0 10px;font-size:16px">Thông báo nổi (năm mức) — trong khung .notice-stack như ở app thật</h2><div class="notice-stack" style="position:static;width:100%">' + tones.map(toast).join('') + '</div></section>' +
    '<section><h2 style="margin:0 0 10px;font-size:16px">Khung trong trang</h2><div style="display:grid;gap:10px">' + tones.map(notice).join('') + '</div>' +
    '<h2 style="margin:18px 0 10px;font-size:16px">Nhãn trạng thái</h2><div style="display:flex;flex-wrap:wrap;gap:8px">' + badges.map((b) => badge(...b)).join('') + '</div>' +
    '<h2 style="margin:18px 0 10px;font-size:16px">Nút</h2><div style="display:flex;flex-wrap:wrap;gap:10px"><button class="btn btn-primary">Nút chính</button><button class="btn">Nút phụ</button><button class="btn btn-danger">Xóa (nguy hiểm)</button><button class="btn" disabled>Tắt</button></div>' +
    '<div class="progress" style="margin-top:14px"><span style="width:62%"></span></div></section>';
  document.body.appendChild(host);
}

async function gotoPage(page, id) {
  // Click thẳng bằng DOM API: locator.click() đòi phần tử "ổn định" (bounding box không đổi qua 2 khung
  // liên tiếp) — ở cỡ cửa sổ hẹp hoặc có zoom (--responsive), phần bọc icon có thể chưa "ổn định" theo
  // định nghĩa đó dù đã hiện rõ và bấm được, khiến Playwright lặp chờ rồi báo timeout.
  const ok = await page.evaluate((pageId) => {
    const button = document.querySelector(`[data-page-id="${pageId}"]`);
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  }, id);
  if (!ok) return false;
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
        if (id === 'about') {
          // Mục "Bộ nhận diện" nằm dưới màn hình đầu: chụp riêng cả khối.
          const kit = handle.page.locator('[data-testid="brand-kit"]');
          if (await kit.count()) {
            const kitFile = join(directory, `${String(number).padStart(2, '0')}b-bo-nhan-dien.png`);
            // Nới cửa sổ cho vừa cả khối rồi chụp phần tử (chụp phần tử đang cuộn sẽ dính thanh trên cùng).
            const kitHeight = await kit.first().evaluate((element) => Math.ceil(element.getBoundingClientRect().height));
            await setSize(handle, `${size.split('x')[0]}x${Math.min(4000, kitHeight + 280)}`);
            await kit.first().scrollIntoViewIfNeeded();
            await sleep(300);
            await kit.first().screenshot({ path: kitFile });
            shots.push(kitFile);
            await setSize(handle, size);
            await handle.page.locator('.page-shell').first().evaluate((element) => { element.scrollTop = 0; });
          }
        }
        if (auditColors) {
          const result = await handle.page.evaluate(auditPageColors);
          auditResults.push({ state, size, theme, page: id, ...result });
        }
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

// Thông tin về vệt sáng đang chạy trên trang: tên, thuộc tính được animate, số lần lặp.
const glintInfo = () =>
  document.getAnimations().filter((animation) => String(animation.animationName ?? '').startsWith('dev-card-glint')).map((animation) => {
    const timing = animation.effect.getComputedTiming();
    const properties = new Set();
    for (const frame of animation.effect.getKeyframes()) {
      for (const key of Object.keys(frame)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) properties.add(key);
    }
    return { name: animation.animationName, playState: animation.playState, properties: [...properties].sort(), iterations: timing.iterations, duration: timing.duration };
  });

// Đóng băng vệt sáng ở giữa hiệu ứng để chụp một khung.
const freezeGlint = (milliseconds) => {
  const found = document.getAnimations().filter((animation) => String(animation.animationName ?? '').startsWith('dev-card-glint'));
  for (const animation of found) {
    animation.pause();
    animation.currentTime = milliseconds;
  }
  return found.length;
};

async function captureDeveloperCard(handle) {
  const directory = join(outRoot, label, 'the-phat-trien');
  mkdirSync(directory, { recursive: true });
  const report = { khungGiua: [], hieuUng: {} };
  for (const size of ['1440x900', '920x640']) {
    await setSize(handle, size);
    for (const theme of themes) {
      await applyTheme(handle.page, theme);
      await gotoPage(handle.page, 'editor-home');
      await dismissOverlays(handle.page);
      await handle.page.mouse.move(700, 500);
      await sleep(3_300); // chờ vệt sáng intro (trễ 1,2 giây + chạy 1,5 giây) chạy xong
      const footer = handle.page.locator('.sidebar-footer');
      const staticFile = join(directory, `thanh-ben-${size}-${theme}-tinh.png`);
      await footer.screenshot({ path: staticFile });
      shots.push(staticFile);
      await handle.page.locator('.dev-card').first().hover();
      await sleep(150);
      const frozen = await handle.page.evaluate(freezeGlint, 520);
      const midFile = join(directory, `thanh-ben-${size}-${theme}-vet-sang.png`);
      await footer.screenshot({ path: midFile });
      shots.push(midFile);
      report.khungGiua.push({ size, theme, animationsFrozen: frozen });
      await handle.page.mouse.move(700, 500);
      await sleep(300);
    }
  }
  // Trang Thông tin (thẻ cùng thành phần, không có intro)
  await setSize(handle, '1440x900');
  for (const theme of themes) {
    await applyTheme(handle.page, theme);
    await gotoPage(handle.page, 'about');
    await dismissOverlays(handle.page);
    await handle.page.mouse.move(700, 800);
    await sleep(600);
    const wrapper = handle.page.locator('.about-brand-signature');
    const staticFile = join(directory, `thong-tin-${theme}-tinh.png`);
    await wrapper.screenshot({ path: staticFile });
    shots.push(staticFile);
    await handle.page.locator('.about-brand-signature .dev-card').hover();
    await sleep(150);
    await handle.page.evaluate(freezeGlint, 520);
    const midFile = join(directory, `thong-tin-${theme}-vet-sang.png`);
    await wrapper.screenshot({ path: midFile });
    shots.push(midFile);
    await handle.page.mouse.move(700, 800);
  }
  // Kiểm tra hành vi THẬT của hiệu ứng trên giao diện đang chạy.
  await applyTheme(handle.page, themes[0]);
  await gotoPage(handle.page, 'about');
  await handle.page.emulateMedia({ reducedMotion: 'no-preference' });
  await handle.page.mouse.move(700, 800);
  await sleep(400);
  await handle.page.locator('.about-brand-signature .dev-card').hover();
  await sleep(200);
  report.hieuUng.khiTroChuot = await handle.page.evaluate(glintInfo);
  await sleep(1_600);
  report.hieuUng.sauKhiChayXong = await handle.page.evaluate(glintInfo);
  report.hieuUng.visibleKhiChayXong = await handle.page.evaluate(() => getComputedStyle(document.querySelector('.about-brand-signature .dev-card-glint')).opacity);
  await handle.page.mouse.move(700, 800);
  await sleep(400);
  await handle.page.emulateMedia({ reducedMotion: 'reduce' });
  await handle.page.locator('.about-brand-signature .dev-card').hover();
  await sleep(300);
  report.hieuUng.giamChuyenDong = {
    animations: await handle.page.evaluate(glintInfo),
    glintDisplay: await handle.page.evaluate(() => getComputedStyle(document.querySelector('.about-brand-signature .dev-card-glint')).display)
  };
  await handle.page.emulateMedia({ reducedMotion: 'no-preference' });
  // Trong lúc "ghép video" thẻ không được tự chạy hiệu ứng: đứng yên 3 giây, không có animation nào của thẻ.
  await handle.page.mouse.move(700, 800);
  await sleep(3_000);
  report.hieuUng.khiDungYen = await handle.page.evaluate(glintInfo);
  writeFileSync(join(directory, 'kiem-tra-hieu-ung.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`Đã ghi ảnh và kiểm tra hiệu ứng thẻ: ${directory}`);
}

// Lưới 4 cỡ cửa sổ × 3 tỉ lệ hiển thị (đặc tả GĐ 2a mục B.5): xác nhận co giãn liên tục, không giật,
// không cuộn ngang, và thanh bên thu gọn đúng mốc. Chạy độc lập với capturePass thường.
async function captureResponsiveGrid(handle) {
  const directory = join(outRoot, label, 'responsive');
  mkdirSync(directory, { recursive: true });
  const report = [];
  for (const size of RESPONSIVE_SIZES) {
    for (const scale of RESPONSIVE_SCALES) {
      await setSize(handle, size);
      await applyScale(handle, scale);
      for (const [id, slug] of RESPONSIVE_PAGES) {
        await gotoPage(handle.page, id);
        await dismissOverlays(handle.page);
        const overflow = await handle.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        const sidebarWidth = await handle.page.evaluate(() => document.querySelector('.app-sidebar')?.getBoundingClientRect().width ?? null);
        const file = join(directory, `${size}-${scale}pc-${slug}.png`);
        await handle.page.screenshot({ path: file });
        shots.push(file);
        report.push({ size, scalePercent: scale, page: id, horizontalOverflow: overflow, sidebarWidthPx: sidebarWidth ? Number(sidebarWidth.toFixed(1)) : null });
      }
    }
  }
  await applyScale(handle, 100);
  const reportFile = join(directory, 'bao-cao-responsive.json');
  writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Đã chụp lưới responsive (${RESPONSIVE_SIZES.length} cỡ × ${RESPONSIVE_SCALES.length} tỉ lệ × ${RESPONSIVE_PAGES.length} trang): ${directory}`);
  const overflowing = report.filter((row) => row.horizontalOverflow);
  if (overflowing.length) console.log(`  CẢNH BÁO: ${overflowing.length} trường hợp bị cuộn ngang: ${overflowing.map((row) => `${row.size}@${row.scalePercent}%/${row.page}`).join(', ')}`);
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
  if (captureGallery) {
    for (const theme of themes) {
      await applyTheme(handle.page, theme);
      await handle.page.evaluate(buildToneGallery);
      await sleep(400);
      const galleryDirectory = join(outRoot, label, 'thu-vien-thong-bao');
      mkdirSync(galleryDirectory, { recursive: true });
      const galleryFile = join(galleryDirectory, `${theme}.png`);
      await handle.page.screenshot({ path: galleryFile });
      shots.push(galleryFile);
      await handle.page.evaluate(() => document.getElementById('tone-gallery')?.remove());
    }
  }
  if (captureCard) await captureDeveloperCard(handle);
  if (captureResponsive) await captureResponsiveGrid(handle);
  await closeApp(handle);
  handle = null;
  if (auditColors) {
    const auditFile = join(outRoot, label, 'audit-mau.json');
    writeFileSync(auditFile, JSON.stringify(auditResults, null, 2), 'utf8');
    console.log(`Đã ghi kiểm tra màu: ${auditFile}`);
  }
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
