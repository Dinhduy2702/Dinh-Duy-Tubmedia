// Đo hiệu năng THẬT của hệ chuyển động (Giai đoạn 2a, hạng mục B.4) bằng Playwright điều khiển Electron
// thật — không phải số ước lượng. Bốn kịch bản: (A) chuyển trang liên tục, (B) mở/đóng hộp thoại liên
// tục, (C) hàng đợi 30 tác vụ cập nhật tiến độ, (D) đang tải 1 video ngắn THẬT (nguồn cục bộ, không mạng).
//
// AN TOÀN: giống scripts/capture-ui-screenshots.mjs — dữ liệu tách biệt (TUBMEDIA_E2E_USER_DATA), chặn
// hộp thoại hệ điều hành, không tải công cụ, không mạng cập nhật, không đụng cookie/tài khoản thật.
// Kịch bản D dùng máy chủ HTTP cục bộ phát một clip testsrc do chính ffmpeg đã cài dựng ra — không có
// yêu cầu mạng nào rời khỏi máy.
/* global window, document, performance, PerformanceObserver, requestAnimationFrame, HTMLElement -- chạy trong trang qua page.evaluate */
/* global setTimeout -- chạy trong tiến trình chính Electron qua application.evaluate */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from '@playwright/test';

const projectRoot = resolve(process.cwd());
const outFile = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(homedir(), 'Tubmedia-anh-so-sanh', 'sau-gd2a', 'hieu-nang-that.json'));

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

const sandbox = mkdtempSync(join(tmpdir(), 'tubmedia-perf-'));
const userData = join(sandbox, 'userdata');
const folders = { source: join(sandbox, 'nguon'), temp: join(sandbox, 'tam'), output: join(sandbox, 'thanh-pham') };
for (const folder of Object.values(folders)) mkdirSync(folder, { recursive: true });
mkdirSync(join(userData, 'database'), { recursive: true });

function seedSettings() {
  const db = new DatabaseSync(join(userData, 'database', 'studio.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
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
  db.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json')
    .run('app', JSON.stringify(settings), new Date().toISOString());
  db.close();
  return settings;
}
const settings = seedSettings();

async function launch() {
  const application = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: { ...process.env, TUBMEDIA_E2E: '1', TUBMEDIA_E2E_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '0' }
  });
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
  // "Thư mục lưu" của Tải nhanh mặc định đọc app.getPath('downloads') (Downloads thật) — đổi sang thư mục
  // tách biệt để kịch bản D không ghi tệp thử vào thư mục Tải xuống thật của người dùng.
  await application.evaluate(({ app }, downloadsPath) => app.setPath('downloads', downloadsPath), folders.output);
  const page = await application.firstWindow();
  await page.waitForSelector('.app-sidebar', { timeout: 60_000 });
  await page.evaluate(() => {
    window.confirm = () => false;
    window.prompt = () => null;
  });
  return { application, page };
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
    // App thường đóng kết nối ngay khi thoát — bỏ qua lỗi kết nối.
  }
}

// ---------------------------------------------------------------- đo trong trang
const START_PROBE = () => {
  window.__perf = { longTasks: [], frames: [], observing: true };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    window.__perf.longTaskUnsupported = true;
  }
  const tick = (t) => {
    window.__perf.frames.push(t);
    if (window.__perf.observing) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const STOP_PROBE = () => {
  window.__perf.observing = false;
  const { longTasks, frames } = window.__perf;
  const durationMs = frames.length >= 2 ? frames.at(-1) - frames[0] : 0;
  const fps = durationMs > 0 ? (frames.length - 1) / (durationMs / 1000) : 0;
  const frameGaps = frames.slice(1).map((t, i) => t - frames[i]);
  const droppedFrames = frameGaps.filter((gap) => gap > 33.34).length; // > 2 khung ở 60fps
  return {
    longTaskCount: longTasks.length,
    longTaskTotalMs: Number(longTasks.reduce((s, t) => s + t.duration, 0).toFixed(1)),
    longTaskMaxMs: longTasks.length ? Number(Math.max(...longTasks.map((t) => t.duration)).toFixed(1)) : 0,
    frameCount: frames.length,
    windowMs: Number(durationMs.toFixed(1)),
    estimatedFps: Number(fps.toFixed(1)),
    droppedFrames,
    longTaskUnsupported: window.__perf.longTaskUnsupported ?? false
  };
};

// Click thẳng bằng DOM API (element.click()) thay vì Playwright locator.click(): locator.click() đợi
// phần tử "ổn định" (bounding box không đổi qua 2 khung liên tiếp) trước khi bấm — dưới hiệu ứng
// chuyển trang liên tục, việc này khiến Playwright lặp chờ rồi báo "detached, retrying" dù nút vẫn còn
// nguyên trên màn hình. Click DOM tức thời phản ánh đúng một cú bấm chuột thật hơn cho phép đo này.
async function gotoPage(page, id) {
  return page.evaluate((pageId) => {
    const button = document.querySelector(`[data-page-id="${pageId}"]`);
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  }, id);
}

// ---------------------------------------------------------------- A. Chuyển trang liên tục
async function measurePageTransitions(page) {
  const sequence = ['step-download', 'step-preview-cut', 'step-merge-export', 'activity', 'history', 'step-download'];
  // Khởi động trước (nạp mã tách theo trang — React.lazy) NGOÀI cửa sổ đo, vì lần đầu mở một trang tốn
  // thời gian tải mã, không phản ánh chi phí chuyển trang thật khi app đã dùng một lúc.
  const warmupFailures = [];
  for (const id of sequence) {
    const ok = await gotoPage(page, id);
    if (!ok) warmupFailures.push(id);
    await sleep(250);
  }

  await page.evaluate(START_PROBE);
  const clickLatenciesMs = [];
  const failures = [];
  for (let loop = 0; loop < 3; loop += 1) {
    for (const id of sequence) {
      // Khoảng nghỉ ngắn giữa hai lần bấm: người dùng bấm nhanh vẫn có độ trễ vài chục ms giữa hai lần
      // bấm; 0ms liên tục là giả định phi thực tế và khiến Playwright click hụt khi hiệu ứng đang chạy.
      await sleep(80);
      const t0 = await page.evaluate(() => performance.now());
      const ok = await gotoPage(page, id);
      if (!ok) {
        failures.push(id);
        continue;
      }
      const t1 = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now()))));
      clickLatenciesMs.push(Number((t1 - t0).toFixed(1)));
    }
  }
  const probe = await page.evaluate(STOP_PROBE);
  clickLatenciesMs.sort((a, b) => a - b);
  const p95 = clickLatenciesMs[Math.floor(clickLatenciesMs.length * 0.95)] ?? clickLatenciesMs.at(-1) ?? 0;
  return {
    scenario: `A. Chuyển trang liên tục (${sequence.length * 3} lần bấm, ${sequence.length} trang × 3 vòng, đã khởi động trước)`,
    warmupFailures,
    failures,
    clicks: clickLatenciesMs.length,
    clickToNextFrameMsAvg: Number((clickLatenciesMs.reduce((s, v) => s + v, 0) / clickLatenciesMs.length).toFixed(1)),
    clickToNextFrameMsP95: p95,
    clickToNextFrameMsMax: clickLatenciesMs.at(-1) ?? 0,
    ...probe
  };
}

// ---------------------------------------------------------------- B. Mở/đóng hộp thoại liên tục
async function measureDialogCycles(page) {
  await gotoPage(page, 'step-download');
  await page.waitForSelector('[data-testid="quick-download-panel"]', { timeout: 15_000 });
  await page.evaluate(START_PROBE);
  const cycles = 20;
  const openLatenciesMs = [];
  for (let i = 0; i < cycles; i += 1) {
    const t0 = await page.evaluate(() => performance.now());
    await page.locator('.quick-download-cookie-button').first().click();
    await page.waitForSelector('.cookie-dialog', { state: 'visible', timeout: 5_000 });
    const t1 = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now()))));
    openLatenciesMs.push(Number((t1 - t0).toFixed(1)));
    await page.locator('.cookie-dialog header button').first().click();
    await page.waitForSelector('.cookie-dialog', { state: 'hidden', timeout: 5_000 });
  }
  const probe = await page.evaluate(STOP_PROBE);
  openLatenciesMs.sort((a, b) => a - b);
  return {
    scenario: `B. Mở/đóng hộp thoại Cookies liên tục (${cycles} lần)`,
    cycles,
    openToNextFrameMsAvg: Number((openLatenciesMs.reduce((s, v) => s + v, 0) / openLatenciesMs.length).toFixed(1)),
    openToNextFrameMsP95: openLatenciesMs[Math.floor(openLatenciesMs.length * 0.95)] ?? 0,
    ...probe
  };
}

// ---------------------------------------------------------------- C. Hàng đợi 30 tác vụ cập nhật tiến độ
async function measureQueueBurst(handle) {
  const { application, page } = handle;
  await gotoPage(page, 'activity');
  await sleep(300);
  await page.evaluate(START_PROBE);

  const jobCount = 30;
  const ticksPerJob = 30; // ~3 giây ở 10 Hz mỗi tác vụ
  const startedAt = new Date().toISOString();
  await application.evaluate(
    async ({ BrowserWindow }, { jobCount: count, ticksPerJob: ticks, startedAt: started }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      const IPC_JOB_PROGRESS = 'events:job-progress';
      const jobs = Array.from({ length: count }, (_unused, index) => ({
        id: `perf-job-${index + 1}`,
        projectId: 'perf-project',
        type: 'download',
        status: 'downloading',
        priority: 0,
        sourceId: null,
        itemId: null,
        input: { displayName: `Video đo hiệu năng #${index + 1}`, url: `https://example.invalid/perf-${index + 1}` },
        progress: 0,
        speed: '1,2 MB/s',
        etaSeconds: 30,
        attempts: 1,
        maxAttempts: 3,
        errorCode: null,
        errorMessage: null,
        createdAt: started,
        updatedAt: started,
        startedAt: started,
        finishedAt: null
      }));
      for (let tick = 0; tick < ticks; tick += 1) {
        for (const job of jobs) {
          job.progress = Math.min(100, Math.round(((tick + 1) / ticks) * 100));
          job.updatedAt = new Date().toISOString();
          win.webContents.send(IPC_JOB_PROGRESS, job);
        }
        await new Promise((resolve) => setTimeout(resolve, 100)); // 10 Hz mỗi tác vụ, đúng ngân sách đặc tả
      }
    },
    { jobCount, ticksPerJob, startedAt }
  );
  await sleep(400); // để lượt flush cuối (JOB_FLUSH_MS=150ms) kịp vẽ
  const probe = await page.evaluate(STOP_PROBE);
  // .queue-studio-row: danh sách có ảo hóa (chỉ vẽ dòng trong khung nhìn) — số dòng THẬT trong DOM, không phải 30.
  const renderedRows = await page.locator('.queue-studio-row').count().catch(() => 0);
  return {
    scenario: `C. Hàng đợi ${jobCount} tác vụ cập nhật tiến độ (10 lần/giây mỗi tác vụ, ~3 giây)`,
    jobCount,
    updatesPerJob: ticksPerJob,
    totalIpcMessages: jobCount * ticksPerJob,
    renderedRowsAfterBurst: renderedRows,
    ...probe
  };
}

// ---------------------------------------------------------------- D. Đang tải 1 video ngắn THẬT (nguồn cục bộ)
async function makeLocalClip() {
  const clipDirectory = join(sandbox, 'nguon-that');
  mkdirSync(clipDirectory, { recursive: true });
  const clipPath = join(clipDirectory, 'clip-do-hieu-nang.mp4');
  const result = spawnSync(
    join(toolsDirectory, 'ffmpeg.exe'),
    ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', clipPath],
    { stdio: 'ignore', windowsHide: true, timeout: 60_000 }
  );
  if (result.status !== 0 || !existsSync(clipPath)) throw new Error('Không dựng được clip thử (ffmpeg lỗi).');
  return clipPath;
}

function startLocalServer(clipPath) {
  const data = readFileSync(clipPath);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Length', String(data.length));
    response.end(data);
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }));
  });
}

async function measureRealLocalDownload(page) {
  const clipPath = await makeLocalClip();
  const { server, port } = await startLocalServer(clipPath);
  try {
    await gotoPage(page, 'step-download');
    await page.waitForSelector('[data-testid="quick-download-panel"]', { timeout: 15_000 });
    await page.locator('.quick-download-field.full input').fill(`http://127.0.0.1:${port}/clip.mp4`);
    await sleep(200);

    await page.evaluate(START_PROBE);
    const t0 = await page.evaluate(() => performance.now());
    await page.locator('.quick-download-start-lg').click();

    // "Mở vị trí file" chỉ hiện khi status.phase === 'completed' && status.outputPath — dấu hiệu tin cậy hơn
    // đọc chữ trạng thái (có thể đổi câu chữ). Đua với khối phục hồi lỗi để không chờ hết hạn vô ích.
    let finished = false;
    let lastPhase = 'running';
    try {
      await Promise.race([
        page.waitForSelector('button:has-text("Mở vị trí file")', { timeout: 60_000 }).then(() => {
          finished = true;
          lastPhase = 'completed';
        }),
        page
          .waitForSelector('.quick-download-recovery-block, .quick-download-error, .quick-download-cookie-block', { timeout: 60_000 })
          .then(async (element) => {
            lastPhase = `failed: ${(await element.textContent())?.trim().slice(0, 200) ?? ''}`;
          })
      ]);
    } catch {
      lastPhase = 'timeout (60s) — chưa thấy hoàn tất hay báo lỗi';
    }
    const t1 = await page.evaluate(() => performance.now());
    const probe = await page.evaluate(STOP_PROBE);
    return {
      scenario: 'D. Đang tải 1 video ngắn THẬT (nguồn cục bộ, 6 giây testsrc qua HTTP 127.0.0.1)',
      finished,
      lastPhase,
      wallClockMs: Number((t1 - t0).toFixed(1)),
      ...probe
    };
  } finally {
    server.close();
  }
}

const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : 'a,b,c,d';
const only = new Set(onlyArg.split(','));

const results = { measuredAt: new Date().toISOString(), settings: { ytdlpPath: settings.ytdlpPath, ffmpegPath: settings.ffmpegPath } };
let handle = null;
try {
  handle = await launch();
  if (only.has('a')) results.a_pageTransitions = await measurePageTransitions(handle.page);
  if (only.has('b')) results.b_dialogCycles = await measureDialogCycles(handle.page);
  if (only.has('c')) results.c_queueBurst = await measureQueueBurst(handle);
  if (only.has('d')) results.d_realLocalDownload = await measureRealLocalDownload(handle.page);
} finally {
  if (handle) await closeApp(handle);
  await sleep(500);
  if (sandbox.startsWith(tmpdir()) && sandbox.includes('tubmedia-perf-')) rmSync(sandbox, { recursive: true, force: true });
}

mkdirSync(join(outFile, '..'), { recursive: true });
writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
console.log(`\nĐã ghi kết quả đo: ${outFile}\n`);
for (const key of ['a_pageTransitions', 'b_dialogCycles', 'c_queueBurst', 'd_realLocalDownload']) {
  if (!results[key]) continue;
  console.log(`--- ${results[key].scenario}`);
  console.log(JSON.stringify(results[key], null, 2));
}

// Ngân sách đặc tả: phản hồi khi bấm <100ms, không long task >50ms khi chạy hiệu ứng, ~60fps ổn định.
const budgetNotes = [];
const checkBudget = (label, value, limit, unit) => {
  const withinBudget = value <= limit;
  budgetNotes.push(`${withinBudget ? 'ĐẠT' : 'CHƯA ĐẠT'} — ${label}: đo được ${value}${unit}, ngân sách ≤ ${limit}${unit}`);
};
if (results.a_pageTransitions) {
  checkBudget('A. phản hồi bấm trung bình', results.a_pageTransitions.clickToNextFrameMsAvg, 100, 'ms');
  checkBudget('A. long task lớn nhất', results.a_pageTransitions.longTaskMaxMs, 50, 'ms');
}
if (results.b_dialogCycles) {
  checkBudget('B. phản hồi mở hộp thoại trung bình', results.b_dialogCycles.openToNextFrameMsAvg, 100, 'ms');
  checkBudget('B. long task lớn nhất', results.b_dialogCycles.longTaskMaxMs, 50, 'ms');
}
if (results.c_queueBurst) checkBudget('C. long task lớn nhất khi 30 tác vụ cập nhật', results.c_queueBurst.longTaskMaxMs, 50, 'ms');
if (budgetNotes.length) {
  console.log('\n--- Đối chiếu ngân sách hiệu năng (đặc tả GĐ 2a) ---');
  for (const note of budgetNotes) console.log(note);
  writeFileSync(join(outFile, '..', 'hieu-nang-doi-chieu-ngan-sach.txt'), budgetNotes.join('\n') + '\n', 'utf8');
}
