// Giai đoạn 4b (2026-09-23) — kiểm tra THẬT (Electron thật, IPC thật) toàn bộ đường ống
// quét → xác nhận → cách ly → hoàn tác của Dọn dẹp máy, KHÔNG đụng %TEMP%/%LOCALAPPDATA%/%APPDATA%
// thật của máy đang chạy script này: TUBMEDIA_E2E_CLEANUP_ENV_JSON trỏ toàn bộ môi trường quét sang
// một sandbox giả hoàn toàn (chỉ có tác dụng khi biến này được đặt — không tồn tại trong bản phát hành
// thật, xem resolveCleanupEnvironmentOverride() trong src/main/ipc/register-ipc.ts).
/* global window -- chạy trong trang qua page.evaluate */
/* global Buffer -- có sẵn trong Node, ESLint flat config của dự án không tự thêm global này cho .mjs */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

if (!existsSync(join(projectRoot, 'out', 'main', 'index.js'))) {
  fail('Chưa có out/. Chạy trước: npx electron-vite build');
}

const sandbox = mkdtempSync(join(tmpdir(), 'tubmedia-cleanup-quarantine-'));
const userData = join(sandbox, 'userdata');
const cleanupEnv = {
  tempDir: join(sandbox, 'FakeTemp'),
  localAppData: join(sandbox, 'FakeLocal'),
  roamingAppData: join(sandbox, 'FakeRoaming')
};

mkdirSync(join(userData, 'database'), { recursive: true });
mkdirSync(cleanupEnv.tempDir, { recursive: true });
mkdirSync(cleanupEnv.localAppData, { recursive: true });
mkdirSync(cleanupEnv.roamingAppData, { recursive: true });

const db = new DatabaseSync(join(userData, 'database', 'studio.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
db.prepare(
  'INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
).run('app', JSON.stringify({ theme: 'dark', startWithWindows: false, autoCheckAppUpdates: false, autoCheckToolUpdates: false }), new Date().toISOString());
db.close();

// Hai file "rác" thật trong FakeTemp — mô phỏng đúng những gì userTemp thật sẽ tìm thấy trên máy thật.
const fileA = join(cleanupEnv.tempDir, 'rac-a.tmp');
const fileB = join(cleanupEnv.tempDir, 'rac-b.tmp');
writeFileSync(fileA, Buffer.alloc(10_000, 1));
writeFileSync(fileB, Buffer.alloc(20_000, 2));
const totalBytes = 30_000;

const application = await electron.launch({
  args: ['.'],
  cwd: projectRoot,
  env: {
    ...process.env,
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: userData,
    TUBMEDIA_E2E_CLEANUP_ENV_JSON: JSON.stringify(cleanupEnv)
  }
});
const page = await application.firstWindow();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
await page.waitForSelector('.app-sidebar', { timeout: 60_000 });

// Ngay sau khi khởi động, ToolManager chạy kiểm tra yt-dlp/ffmpeg --version ở nền (đăng ký như tiến
// trình "đang chạy") — mode 'clean' bị chặn khi có bất kỳ tiến trình nào đang chạy (đúng như thiết kế,
// để không xóa dữ liệu trong khi có tác vụ tải/ghép thật). Thử lại vài lần thay vì đoán một khoảng chờ.
async function startCleanWithRetry(categories, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await page.evaluate((cats) => window.desktop.systemCleanup.start({ mode: 'clean', categories: cats }), categories);
    } catch (error) {
      if (Date.now() > deadline || !String(error.message).includes('đang chạy')) throw error;
      await sleep(300);
    }
  }
}

async function waitForTerminal(runId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await page.evaluate((id) => window.desktop.systemCleanup.status(id), runId);
    if (status && ['completed', 'cancelled', 'failed'].includes(status.phase)) return status;
    if (Date.now() > deadline) throw new Error('Quá thời gian chờ trạng thái kết thúc.');
    await sleep(150);
  }
}

let allOk = true;
function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) allOk = false;
}

try {
  console.log('-- Bước 1: quét (mode estimate) trên môi trường giả --');
  const scanStarted = await page.evaluate(
    () => window.desktop.systemCleanup.start({ mode: 'estimate', categories: ['userTemp'] })
  );
  const scanFinished = await waitForTerminal(scanStarted.runId);
  check('quét xong (phase completed)', scanFinished.phase === 'completed');
  check(`quét ra đúng ${totalBytes} byte`, scanFinished.estimatedBytes === totalBytes);
  check('quét KHÔNG xóa gì (2 file rác vẫn còn)', existsSync(fileA) && existsSync(fileB));

  console.log('-- Bước 2: xóa thật (mode clean) qua IPC thật --');
  const cleanStarted = await startCleanWithRetry(['userTemp']);
  const cleanFinished = await waitForTerminal(cleanStarted.runId);
  check('dọn xong (phase completed)', cleanFinished.phase === 'completed');
  check(`đã "dọn" đúng ${totalBytes} byte`, cleanFinished.removedBytes === totalBytes);
  check('2 file rác đã biến mất khỏi vị trí gốc', !existsSync(fileA) && !existsSync(fileB));

  console.log('-- Bước 3: danh sách khu cách ly qua IPC thật --');
  const quarantineList = await page.evaluate(() => window.desktop.systemCleanup.quarantineList());
  check('khu cách ly có đúng 2 mục', quarantineList.length === 2);
  const quarantineDir = join(userData, 'cleanup-quarantine');
  check('khu cách ly nằm trong userData ĐÃ SANDBOX (không phải userData thật)', existsSync(quarantineDir));
  for (const entry of quarantineList) {
    const blobPath = join(quarantineDir, 'files', entry.id);
    check(`file cách ly ${entry.id} tồn tại thật trên đĩa`, existsSync(blobPath));
  }

  console.log('-- Bước 4: hoàn tác qua IPC thật --');
  const restoreOutcomes = await page.evaluate(
    (ids) => window.desktop.systemCleanup.quarantineRestore(ids),
    quarantineList.map((entry) => entry.id)
  );
  check('cả 2 mục hoàn tác thành công', restoreOutcomes.every((outcome) => outcome.ok));
  check('2 file rác đã trở lại đúng vị trí gốc', existsSync(fileA) && existsSync(fileB));
  check(
    'nội dung file khôi phục đúng byte-for-byte',
    readFileSync(fileA).equals(Buffer.alloc(10_000, 1)) && readFileSync(fileB).equals(Buffer.alloc(20_000, 2))
  );

  const listAfterRestore = await page.evaluate(() => window.desktop.systemCleanup.quarantineList());
  check('khu cách ly rỗng sau khi hoàn tác hết', listAfterRestore.length === 0);

  console.log('\n=== KẾT QUẢ ===');
  console.log(allOk ? 'ĐẠT: toàn bộ đường ống quét → xóa → cách ly → hoàn tác hoạt động đúng qua IPC thật.' : 'CHƯA ĐẠT — xem chi tiết ở trên.');
} finally {
  await application.close();
  rmSync(sandbox, { recursive: true, force: true });
}

if (!allOk) process.exit(1);
