import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

const awarenessPath = path.join(cwd, 'src', 'main', 'update', 'startup-update-awareness.ts');

const rendererPath = path.join(cwd, 'src', 'renderer', 'src', 'update-awareness.ts');

const packagePath = path.join(cwd, 'package.json');

let checks = 0;
let failures = 0;

function check(condition, label) {
  checks += 1;

  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${label}`);
  }
}

function eventRange(source, eventName) {
  const single = `autoUpdater.on('${eventName}'`;
  const double = `autoUpdater.on("${eventName}"`;

  let start = source.indexOf(single);

  if (start < 0) {
    start = source.indexOf(double);
  }

  if (start < 0) {
    return '';
  }

  const nextOn = source.indexOf('autoUpdater.on(', start + 1);
  const nextIpc = source.indexOf('ipcMain.handle(', start + 1);

  const candidates = [nextOn, nextIpc, source.length].filter((value) => value >= 0);

  const end = Math.min(...candidates);

  return source.slice(start, end);
}

const awareness = fs.readFileSync(awarenessPath, 'utf8');
const renderer = fs.readFileSync(rendererPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

check(
  /function\s+shouldShowToast\s*\(/.test(renderer) &&
    /\['available',\s*'downloading',\s*'downloaded'\]/.test(renderer),
  'startup toast is limited to confirmed update workflow states'
);

check(
  /if\s*\(\s*!shouldShowToast\(state\)\s*\)\s*\{\s*hideToast\(\)/s.test(renderer),
  'checking, idle and error states are hidden instead of rendered'
);

check(
  !renderer.includes("'checking'\n        ? 'Đang kiểm tra cập nhật'") &&
    !renderer.includes("state.status === 'error'\n      return 'Kiểm tra lại'"),
  'renderer no longer has checking/error popup UX branches'
);

check(
  !/description\.textContent\s*=\s*state\.message/.test(renderer),
  'raw updater error messages are never rendered into the startup toast'
);

check(
  /UPDATE_AVAILABLE_AUTO_DISMISS_MS\s*=\s*12_000/.test(renderer) &&
    /scheduleAvailableAutoDismiss\s*\(\s*\)/.test(renderer),
  'confirmed update toast auto-dismisses after twelve seconds'
);

check(
  /announcedVersion\s*===\s*version/.test(renderer) && /state\.status\s*===\s*'available'/.test(renderer),
  'same release is not repeatedly re-announced after dismissal'
);

const initializeMatch = renderer.match(/async function initialize\(\): Promise<void> \{([\s\S]*?)\n\}/);

check(
  Boolean(initializeMatch) && !/api\.checkNow\s*\(/.test(initializeMatch?.[1] ?? ''),
  'renderer does not launch a duplicate automatic update check'
);

check(
  renderer.includes('data-tubmedia-update-dot') &&
    renderer.includes('#ef4444') &&
    renderer.includes('Cập nhật ngay') &&
    renderer.includes('Cài đặt & khởi động lại'),
  'real update red-dot and update/install actions remain available'
);

const availableRange = eventRange(awareness, 'update-available');
const errorRange = eventRange(awareness, 'error');
const checkingRange = eventRange(awareness, 'checking-for-update');
const noUpdateRange = eventRange(awareness, 'update-not-available');

if (!availableRange) {
  console.log('DEBUG: update-available event range was not found');
} else {
  console.log(`INFO: update-available range length=${availableRange.length}`);
}

check(
  availableRange.includes('showUpdateNotification'),
  'desktop notification is emitted only from the confirmed update-available event range'
);

check(
  !errorRange.includes('showUpdateNotification') &&
    !checkingRange.includes('showUpdateNotification') &&
    !noUpdateRange.includes('showUpdateNotification'),
  'checking/no-update/error event ranges never emit desktop update notifications'
);

check(
  pkg.scripts?.['verify:update-notification-ux'] === 'node scripts/verify-update-notification-ux-pre132.mjs',
  'update notification UX verifier is registered'
);

check(
  typeof pkg.scripts?.check === 'string' &&
    pkg.scripts.check.includes('npm run verify:update-notification-ux'),
  'update notification UX verifier is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`Update notification UX verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia update notification UX verification OK: ${checks} checks.`);
