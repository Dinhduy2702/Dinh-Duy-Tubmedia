// Vấn đề 2 mục 1 (2026-09-22) — kiểm tra THẬT bằng Electron thật + tải CPU giả lập THẬT (không chỉ đọc
// code, không giả lập đồng hồ): bật 2 tác vụ tải cục bộ (không mạng) trong CÙNG một danh sách (cho phép
// chạy song song), rồi tạo tải CPU THẬT bằng các tiến trình Node.js chạy vòng lặp bận trên máy thật, đo
// CPU hệ thống THẬT (window.desktop.app.systemStats()) và xác nhận:
//   1. CPU đo được thật sự tăng khi có tải.
//   2. Tác vụ THỨ HAI (không phải đầu tiên) bị tạm hoãn khi CPU cao liên tục đủ lâu — tác vụ ĐANG CHẠY
//      không bị ảnh hưởng.
//   3. Không "nhấp nháy" — đếm số lần đổi trạng thái throttled trong suốt phiên đo phải nhỏ (2, đúng một
//      lần bật + một lần tắt), không dao động liên tục.
//   4. Sau khi ngừng tải CPU, hệ thống tự tăng tải lại (throttled quay về false, tác vụ thứ hai được chạy).
//
// AN TOÀN: giống các script đo hiệu năng khác — dữ liệu tách biệt (TUBMEDIA_E2E_USER_DATA), không mạng
// (máy chủ HTTP cục bộ 127.0.0.1 phát một clip testsrc do chính ffmpeg đã cài dựng ra, cố tình phát chậm
// để có đủ thời gian quan sát), không đụng cookie/tài khoản thật, không xóa file người dùng.
/* global window, document -- chạy trong trang qua page.evaluate */
/* global setTimeout -- chạy trong tiến trình chính Node qua setTimeout thường (máy chủ HTTP nhỏ giọt) */
import { createServer } from 'node:http';
import { spawnSync, fork } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from '@playwright/test';

const projectRoot = resolve(process.cwd());
const outFile = resolve(
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : join(homedir(), 'Tubmedia-anh-so-sanh', 'sau-vd2-muc1', 'do-that-giam-tai.json')
);

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
if (!toolsDirectory) fail('Không tìm thấy yt-dlp/ffmpeg/ffprobe để đo. Không tự tải công cụ.');

const sandbox = mkdtempSync(join(tmpdir(), 'tubmedia-load-governor-'));
const userData = join(sandbox, 'userdata');
const folders = { source: join(sandbox, 'nguon'), temp: join(sandbox, 'tam'), output: join(sandbox, 'thanh-pham') };
for (const folder of Object.values(folders)) mkdirSync(folder, { recursive: true });
mkdirSync(join(userData, 'database'), { recursive: true });

// Hồ sơ tài nguyên riêng cho phép đo: ngưỡng CPU thấp (40%) để KHÔNG cần đẩy máy thật lên gần 100% mới
// quan sát được — an toàn hơn cho máy đang chạy phép đo, vẫn là một ngưỡng thật do người dùng có thể đặt.
const THROTTLE_PROFILE_ID = 'resource-load-governor-that';
function seedSettingsAndProfile() {
  const db = new DatabaseSync(join(userData, 'database', 'studio.sqlite'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS resource_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, profile_json TEXT NOT NULL, built_in INTEGER NOT NULL, updated_at TEXT NOT NULL)'
  );
  const now = new Date().toISOString();
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
    defaultResourceProfileId: THROTTLE_PROFILE_ID
  };
  db.prepare(
    'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
  ).run('app', JSON.stringify(settings), now);
  const profile = {
    id: THROTTLE_PROFILE_ID,
    name: 'Đo giảm tải (kịch bản thật)',
    description: 'Chỉ dùng để đo Vấn đề 2 mục 1 — ngưỡng CPU thấp để quan sát nhanh.',
    downloadWorkers: 2,
    analyzeWorkers: 2,
    normalizeWorkers: 1,
    remuxWorkers: 1,
    clipWorkers: 1,
    ffmpegThreads: 2,
    filterThreads: 1,
    filterComplexThreads: 1,
    processPriority: 'below_normal',
    cpuSoftLimitPercent: 40,
    memoryFreeMinimumBytes: 0,
    diskFreeMinimumBytes: 0,
    gpuJobs: 0,
    builtIn: false
  };
  db.prepare(
    'INSERT INTO resource_profiles(id,name,description,profile_json,built_in,updated_at) VALUES(?,?,?,?,?,?)'
  ).run(profile.id, profile.name, profile.description, JSON.stringify(profile), 0, now);
  db.close();
}
seedSettingsAndProfile();

function makeLocalClip() {
  const clipDirectory = join(sandbox, 'nguon-that');
  mkdirSync(clipDirectory, { recursive: true });
  const clipPath = join(clipDirectory, 'clip-do-giam-tai.mp4');
  const result = spawnSync(
    join(toolsDirectory, 'ffmpeg.exe'),
    ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=15:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', clipPath],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  if (result.status !== 0 || !existsSync(clipPath)) throw new Error('Không dựng được clip thử (ffmpeg lỗi).');
  return clipPath;
}

// Phát THẬT nhưng CỐ TÌNH CHẬM (nhỏ giọt từng đoạn có nghỉ) — dữ liệu vẫn đi qua thật (yt-dlp tải thật,
// ghi đĩa thật), chỉ tốc độ bị giới hạn để có đủ thời gian quan sát bộ điều tiết trong lúc tải đang chạy.
function startSlowLocalServer(clipPath, msPerChunk, chunkBytes) {
  const data = readFileSync(clipPath);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Content-Length', String(data.length));
    let offset = 0;
    const pump = () => {
      if (offset >= data.length) {
        response.end();
        return;
      }
      const end = Math.min(offset + chunkBytes, data.length);
      response.write(data.subarray(offset, end));
      offset = end;
      setTimeout(pump, msPerChunk);
    };
    pump();
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }));
  });
}

// Tiến trình con chạy vòng lặp bận THẬT để tạo tải CPU thật trên máy — không giả lập số đo.
const BUSY_LOOP_WORKER = `
const until = Number(process.argv[2]);
while (Date.now() < until) {
  // eslint-disable-next-line no-empty
  for (let i = 0; i < 5_000_000; i += 1) { Math.sqrt(i); }
}
`;
function spawnCpuLoad(durationMs, workerCount) {
  const scriptPath = join(sandbox, 'busy-loop.cjs');
  writeFileSync(scriptPath, BUSY_LOOP_WORKER, 'utf8');
  const until = Date.now() + durationMs;
  const children = [];
  for (let i = 0; i < workerCount; i += 1) {
    children.push(fork(scriptPath, [String(until)], { stdio: 'ignore' }));
  }
  return children;
}
function stopCpuLoad(children) {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* đã tự thoát */
    }
  }
}

const application = await electron.launch({
  args: ['.'],
  cwd: projectRoot,
  env: { ...process.env, TUBMEDIA_E2E: '1', TUBMEDIA_E2E_USER_DATA: userData }
});
const page = await application.firstWindow();
const sawErrors = [];
page.on('pageerror', (error) => sawErrors.push(error.message));
await page.waitForSelector('.app-sidebar', { timeout: 60_000 });

const samples = [];
async function sampleOnce(label) {
  const stats = await page.evaluate(() => window.desktop.app.systemStats());
  const jobs = await page.evaluate(() => window.desktop.queue.list());
  const downloadJobs = jobs.filter((job) => job.type === 'download');
  const activeCount = downloadJobs.filter((job) => ['downloading', 'analyzing', 'verifying'].includes(job.status)).length;
  const pendingCount = downloadJobs.filter((job) => job.status === 'pending').length;
  const entry = {
    t: Date.now(),
    label,
    cpuPercent: Number(stats.cpuPercent.toFixed(1)),
    systemLoadThrottled: stats.systemLoadThrottled,
    activeDownloads: activeCount,
    pendingDownloads: pendingCount
  };
  samples.push(entry);
  return entry;
}

try {
  const clipPath = makeLocalClip();
  // Nhỏ giọt 10KB/250ms = 40 KB/s — clip lớn hơn (640x480, 6 giây) nên mỗi tác vụ mất hơn 15 giây, đủ để
  // còn "đang chạy" (active) suốt cả lúc tạo tải CPU lẫn lúc quan sát hồi phục sau đó.
  const { server, port } = await startSlowLocalServer(clipPath, 250, 10 * 1024);
  const t0 = Date.now();

  await page.evaluate((id) => document.querySelector(`[data-page-id="${id}"]`)?.click(), 'download-workbench');
  await sleep(500);

  // QUAN TRỌNG: tạo tải CPU THẬT TRƯỚC, rồi mới đưa tác vụ vào hàng đợi — để quan sát đúng 2 hành vi:
  // (1) tác vụ ĐẦU TIÊN của cả ứng dụng vẫn được phép bắt đầu dù CPU đang cao (tránh "đói" hoàn toàn);
  // (2) tác vụ THỨ HAI/BA trở đi (active.size > 0 lúc đó) bị tạm hoãn khi CPU cao liên tục đủ lâu.
  console.log(`\n-- Tạo tải CPU THẬT bằng ${cpus().length} tiến trình bận trước, giữ trong 14 giây --`);
  const busyChildren = spawnCpuLoad(14_000, Math.max(2, cpus().length));
  await sleep(1_500); // để CPU thật sự lên cao trước khi tác vụ đầu tiên được xét
  await sampleOnce('cpu-cao-truoc-khi-co-tac-vu');

  const linksText = [1, 2, 3].map((n) => `http://127.0.0.1:${port}/clip${n}.mp4`).join('\n');
  const result = await page.evaluate(
    async ({ linksText, outputFolder, tempFolder, resourceProfileId }) =>
      window.desktop.workbench.startDownload({
        slot: 'download-1',
        name: 'Đo giảm tải',
        linksText,
        outputFolder,
        tempFolder,
        resourceProfileId
      }),
    { linksText, outputFolder: folders.output, tempFolder: folders.temp, resourceProfileId: THROTTLE_PROFILE_ID }
  );
  console.log('Đã bắt đầu danh sách tải (3 link) trong lúc CPU đang cao:', result.project?.name ?? '(không rõ)');

  const loadStart = Date.now();
  let screenshotTaken = false;
  while (Date.now() - loadStart < 14_000) {
    const s = await sampleOnce('dang-tai-cpu');
    console.log(`  [+${((Date.now() - t0) / 1000).toFixed(1)}s] CPU=${s.cpuPercent}% throttled=${s.systemLoadThrottled} active=${s.activeDownloads} pending=${s.pendingDownloads}`);
    if (s.systemLoadThrottled && !screenshotTaken) {
      screenshotTaken = true;
      // Giao diện chỉ cập nhật từ đợt phát định kỳ mỗi 2s (main/index.ts) — chờ thêm để chắc chắn khung
      // hình chụp phản ánh ĐÚNG dữ liệu đã đo (window.desktop.app.systemStats() lấy nhanh hơn đợt phát).
      await sleep(2_200);
      const shotPath = join(outFile, '..', 'nhan-dang-giam-tai-that.png');
      mkdirSync(join(outFile, '..'), { recursive: true });
      await page.screenshot({ path: shotPath });
      console.log(`  (đã chụp ảnh thật lúc đang giảm tải: ${shotPath})`);
    }
    await sleep(500);
  }
  stopCpuLoad(busyChildren);
  console.log('-- Đã dừng tải CPU giả lập --\n');

  const cooldownStart = Date.now();
  while (Date.now() - cooldownStart < 12_000) {
    const s = await sampleOnce('sau-khi-ngung-tai-cpu');
    console.log(`  [+${((Date.now() - t0) / 1000).toFixed(1)}s] CPU=${s.cpuPercent}% throttled=${s.systemLoadThrottled} active=${s.activeDownloads} pending=${s.pendingDownloads}`);
    await sleep(500);
  }

  server.close();

  // Phân tích: đếm số lần systemLoadThrottled ĐỔI giá trị (phát hiện nhấp nháy nếu > 2).
  let transitions = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].systemLoadThrottled !== samples[i - 1].systemLoadThrottled) transitions += 1;
  }
  const maxCpuDuringLoad = Math.max(...samples.filter((s) => s.label === 'dang-tai-cpu').map((s) => s.cpuPercent));
  const everThrottled = samples.some((s) => s.systemLoadThrottled);
  const throttledDuringLoad = samples.filter((s) => s.label === 'dang-tai-cpu' && s.systemLoadThrottled).length;
  const unthrottledAtEnd = !samples[samples.length - 1].systemLoadThrottled;

  const report = {
    measuredAt: new Date().toISOString(),
    cpuSoftLimitPercentUsed: 40,
    sustainedMsExpected: 5000,
    maxCpuDuringLoad,
    everThrottled,
    throttledSampleCountDuringLoad: throttledDuringLoad,
    transitions,
    noFlapping: transitions <= 2,
    unthrottledAtEnd,
    pageErrors: sawErrors,
    samples
  };
  mkdirSync(join(outFile, '..'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== KẾT QUẢ ĐO THẬT ===');
  console.log(`CPU cao nhất đo được lúc tạo tải: ${maxCpuDuringLoad}%`);
  console.log(`Từng chuyển sang "đang giảm tải": ${everThrottled}`);
  console.log(`Số lần đổi trạng thái throttled: ${transitions} (không nhấp nháy nếu <= 2)`);
  console.log(`Đã hết giảm tải ở cuối phiên đo: ${unthrottledAtEnd}`);
  console.log(`Lỗi trang trong lúc đo: ${sawErrors.length}`);
  console.log(`Đã ghi báo cáo: ${outFile}`);
} finally {
  await application.close();
  rmSync(sandbox, { recursive: true, force: true });
}
