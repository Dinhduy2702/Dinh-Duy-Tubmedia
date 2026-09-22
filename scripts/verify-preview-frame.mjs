// Giai đoạn 3 (2026-09-23) — kiểm tra THẬT (Electron thật, yt-dlp thật, ffmpeg thật) đường ống trích khung
// hình xem trước: máy chủ HTTP cục bộ phát MỘT clip testsrc thật do ffmpeg dựng ra (không mạng ngoài),
// gọi window.desktop.quickDownload.previewFrame({url, timestampSeconds}) qua IPC thật, xác nhận nhận
// được data URL ảnh JPEG hợp lệ, và xác nhận KHÔNG còn tệp tạm nào sót lại sau khi xong.
/* global window -- chạy trong trang qua page.evaluate */
/* global Buffer -- có sẵn trong Node, ESLint flat config của dự án không tự thêm global này cho .mjs */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from '@playwright/test';

const projectRoot = resolve(process.cwd());

function fail(message) {
  console.error(`LỖI: ${message}`);
  process.exit(1);
}

function resolveToolsDirectory() {
  const needed = ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe'];
  const candidates = [
    join(projectRoot, 'tool'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Download video Tubmedia', 'resources', 'tool')
  ];
  for (const directory of candidates) {
    if (needed.every((name) => existsSync(join(directory, name)))) return directory;
  }
  return null;
}

if (!existsSync(join(projectRoot, 'out', 'main', 'index.js'))) fail('Chưa có out/. Chạy trước: npx electron-vite build');
const toolsDirectory = resolveToolsDirectory();
if (!toolsDirectory) fail('Không tìm thấy yt-dlp/ffmpeg/ffprobe để đo.');

const sandbox = mkdtempSync(join(tmpdir(), 'tubmedia-preview-frame-'));
const userData = join(sandbox, 'userdata');
mkdirSync(join(userData, 'database'), { recursive: true });
const db = new DatabaseSync(join(userData, 'database', 'studio.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
const settings = {
  theme: 'dark',
  startWithWindows: false,
  autoCheckAppUpdates: false,
  autoCheckToolUpdates: false,
  ytdlpPath: join(toolsDirectory, 'yt-dlp.exe'),
  ffmpegPath: join(toolsDirectory, 'ffmpeg.exe'),
  ffprobePath: join(toolsDirectory, 'ffprobe.exe')
};
db.prepare(
  'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
).run('app', JSON.stringify(settings), new Date().toISOString());
db.close();

function makeLocalClip() {
  const clipDirectory = join(sandbox, 'nguon-that');
  mkdirSync(clipDirectory, { recursive: true });
  const clipPath = join(clipDirectory, 'clip-preview.mp4');
  const result = spawnSync(
    join(toolsDirectory, 'ffmpeg.exe'),
    [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=10:duration=8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', clipPath
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  if (result.status !== 0 || !existsSync(clipPath)) throw new Error('Không dựng được clip thử (ffmpeg lỗi).');
  return clipPath;
}

// yt-dlp coi URL trực tiếp (bộ trích xuất "generic") là để chính FFMPEG tự tải/tua bằng HTTP Range —
// y hệt cách trình duyệt/CDN thật hoạt động khi tua video. Máy chủ thử phải hỗ trợ Range (206 Partial
// Content) đúng chuẩn thì mới mô phỏng đúng hành vi CDN thật; không hỗ trợ sẽ khiến ffmpeg tua sai vị trí
// và nhận luồng byte không khớp (lỗi "Invalid data found" — lỗi máy chủ thử, không phải lỗi tính năng).
function startLocalServer(clipPath) {
  const data = readFileSync(clipPath);
  const server = createServer((request, response) => {
    const range = request.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : data.length - 1;
      response.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${start}-${end}/${data.length}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes'
      });
      response.end(data.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': String(data.length),
      'Accept-Ranges': 'bytes'
    });
    response.end(data);
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }));
  });
}

const application = await electron.launch({
  args: ['.'],
  cwd: projectRoot,
  env: { ...process.env, TUBMEDIA_E2E: '1', TUBMEDIA_E2E_USER_DATA: userData }
});
const page = await application.firstWindow();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
await page.waitForSelector('.app-sidebar', { timeout: 60_000 });
// Chờ THẬT cho tới khi ToolManager báo yt-dlp/ffmpeg sẵn sàng (ensureRequiredReady chạy --version thật ở
// nền lúc khởi động) — không đoán một khoảng chờ cố định.
const readyDeadline = Date.now() + 30_000;
let toolsReady = false;
while (Date.now() < readyDeadline) {
  const list = await page.evaluate(() => window.desktop.tools.list());
  const ytdlp = list.find((t) => t.name === 'yt-dlp');
  const ffmpeg = list.find((t) => t.name === 'ffmpeg');
  if (ytdlp?.available && ffmpeg?.available) {
    toolsReady = true;
    break;
  }
  await sleep(300);
}
console.log('Công cụ sẵn sàng trước khi gọi previewFrame:', toolsReady);

try {
  const clipPath = makeLocalClip();
  const { server, port } = await startLocalServer(clipPath);
  const url = `http://127.0.0.1:${port}/clip.mp4`;

  console.log('-- Gọi previewFrame({url, timestampSeconds: 2}) qua IPC thật --');
  const t0 = Date.now();
  const result = await page.evaluate(
    (u) => window.desktop.quickDownload.previewFrame({ url: u, timestampSeconds: 2 }),
    url
  );
  const elapsedMs = Date.now() - t0;
  server.close();

  const isValidDataUrl = typeof result?.dataUrl === 'string' && result.dataUrl.startsWith('data:image/jpeg;base64,');
  const base64Body = result.dataUrl.slice('data:image/jpeg;base64,'.length);
  const bytes = Buffer.from(base64Body, 'base64');
  // JPEG luôn bắt đầu bằng magic bytes FF D8.
  const isRealJpeg = bytes.length > 100 && bytes[0] === 0xff && bytes[1] === 0xd8;

  console.log('Thời gian xử lý (tải đoạn ngắn + trích khung hình):', elapsedMs, 'ms');
  console.log('Nhận được data URL hợp lệ:', isValidDataUrl);
  console.log('Ảnh JPEG thật (đúng magic bytes, kích thước > 100 byte):', isRealJpeg, `(${bytes.length} byte)`);

  // Xác nhận KHÔNG còn thư mục tạm nào của previewFrame sót lại trong thư mục temp hệ thống.
  // preview-frame-service.ts dùng đúng tiền tố "tubmedia-preview-" (không có "-frame-") — loại trừ thư mục
  // sandbox của CHÍNH script kiểm tra này ("tubmedia-preview-frame-...") để không báo nhầm.
  const leftover = readdirSync(tmpdir()).filter(
    (name) => name.startsWith('tubmedia-preview-') && !name.startsWith('tubmedia-preview-frame-')
  );
  console.log('Thư mục tạm còn sót lại (phải là 0):', leftover.length, leftover);

  console.log('\n=== KẾT QUẢ ===');
  console.log(isValidDataUrl && isRealJpeg && leftover.length === 0 ? 'ĐẠT: pipeline trích khung hình xem trước hoạt động đúng, dọn dẹp sạch.' : 'CHƯA ĐẠT — xem chi tiết ở trên.');
} finally {
  await application.close();
  rmSync(sandbox, { recursive: true, force: true });
}
