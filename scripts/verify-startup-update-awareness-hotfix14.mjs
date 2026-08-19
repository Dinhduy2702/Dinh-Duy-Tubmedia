import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

const paths = {
  service: path.join(cwd, 'src', 'main', 'updates', 'app-update-service.ts'),
  awareness: path.join(cwd, 'src', 'main', 'update', 'startup-update-awareness.ts'),
  preload: path.join(cwd, 'src', 'preload', 'update-awareness-bridge.ts'),
  renderer: path.join(cwd, 'src', 'renderer', 'src', 'update-awareness.ts'),
  packageJson: path.join(cwd, 'package.json')
};

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

function exists(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

check(exists(paths.service), 'AppUpdateService policy module exists');
check(exists(paths.awareness), 'startup update awareness module exists');
check(exists(paths.preload), 'startup update preload bridge exists');
check(exists(paths.renderer), 'startup update renderer module exists');

if (exists(paths.service) && exists(paths.awareness) && exists(paths.preload) && exists(paths.renderer)) {
  const service = read(paths.service);
  const awareness = read(paths.awareness);
  const preload = read(paths.preload);
  const renderer = read(paths.renderer);

  check(
    /autoUpdater\s*\.\s*checkForUpdates\s*\(\s*\)/.test(awareness) &&
      /setTimeout\s*\(/.test(awareness) &&
      /\b1800\b/.test(awareness),
    'packaged app checks for updates automatically on startup'
  );

  check(
    /updater\s*\.\s*autoDownload\s*=\s*false/.test(service) &&
      /updater\s*\.\s*autoInstallOnAppQuit\s*=\s*true/.test(service) &&
      /updater\s*\.\s*allowDowngrade\s*=\s*false/.test(service),
    'AppUpdateService owns user-driven and downgrade-safe updater policy'
  );

  check(
    /updater\s*\.\s*channel\s*=\s*channel\s*;[\s\S]{0,500}?updater\s*\.\s*allowDowngrade\s*=\s*false\s*;/.test(
      service
    ),
    'channel assignment cannot leave downgrade enabled'
  );

  check(
    !/autoUpdater\s*\.\s*channel\s*=/.test(awareness) &&
      !/autoUpdater\s*\.\s*allowDowngrade\s*=/.test(awareness) &&
      !/autoUpdater\s*\.\s*allowPrerelease\s*=/.test(awareness) &&
      !/autoUpdater\s*\.\s*autoDownload\s*=/.test(awareness),
    'startup awareness is observer/UX only and does not own updater policy'
  );

  check(
    /['"]update-available['"]/.test(awareness) &&
      /['"]download-progress['"]/.test(awareness) &&
      /['"]update-downloaded['"]/.test(awareness),
    'updater lifecycle is forwarded into awareness state'
  );

  check(
    /new\s+Notification\s*\(/.test(awareness) && awareness.includes('Tubmedia có bản cập nhật mới'),
    'new release triggers immediate desktop notification'
  );

  check(
    /autoUpdater\s*\.\s*downloadUpdate\s*\(\s*\)/.test(awareness) &&
      /autoUpdater\s*\.\s*quitAndInstall\s*\(\s*false\s*,\s*true\s*\)/.test(awareness),
    'user can download then install and restart from the app'
  );

  check(
    /contextBridge\s*\.\s*exposeInMainWorld\s*\(/.test(preload) &&
      preload.includes('tubmediaUpdateAwareness') &&
      preload.includes('downloadNow') &&
      preload.includes('installNow'),
    'secure preload bridge exposes update actions and state'
  );

  check(
    renderer.includes('data-tubmedia-update-dot') &&
      /#ef4444/i.test(renderer) &&
      renderer.includes('Có bản Tubmedia'),
    'renderer shows a red update dot and immediate in-app update toast'
  );

  check(
    renderer.includes('Cập nhật ngay') &&
      renderer.includes('Cài đặt & khởi động lại') &&
      renderer.includes('progressPercent'),
    'renderer offers one-click update with progress and install restart'
  );

  check(
    /6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(awareness),
    'long-running app rechecks for updates every six hours'
  );

  check(/app\.isPackaged/.test(awareness), 'automatic update check is restricted to packaged builds');
}

const packageJson = JSON.parse(read(paths.packageJson));

check(
  packageJson.scripts?.['verify:startup-update-awareness'] ===
    'node scripts/verify-startup-update-awareness-hotfix14.mjs',
  'startup update verifier is registered in package.json'
);

check(
  typeof packageJson.scripts?.check === 'string' &&
    packageJson.scripts.check.includes('npm run verify:startup-update-awareness'),
  'startup update verification is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`Startup update awareness verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia startup update awareness verification OK: ${checks} checks.`);
