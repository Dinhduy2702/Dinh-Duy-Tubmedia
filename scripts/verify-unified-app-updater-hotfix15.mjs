import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

const servicePath = path.join(cwd, 'src', 'main', 'updates', 'app-update-service.ts');
const awarenessPath = path.join(cwd, 'src', 'main', 'update', 'startup-update-awareness.ts');
const preloadPath = path.join(cwd, 'src', 'preload', 'update-awareness-bridge.ts');
const rendererPath = path.join(cwd, 'src', 'renderer', 'src', 'update-awareness.ts');

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

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walk(root) {
  const result = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      result.push(...walk(full));
    } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      result.push(full);
    }
  }

  return result;
}

const service = read(servicePath);
const awareness = read(awarenessPath);
const preload = read(preloadPath);
const renderer = read(rendererPath);

check(
  /updater\s*\.\s*channel\s*=\s*channel\s*;[\s\S]{0,500}?updater\s*\.\s*allowDowngrade\s*=\s*false\s*;/.test(
    service
  ),
  'AppUpdateService re-locks downgrade safety after assigning channel'
);

check(
  /private\s+configureRuntime[\s\S]{0,1200}?updater\s*\.\s*autoDownload\s*=\s*false/.test(service) &&
    /private\s+configureRuntime[\s\S]{0,1200}?updater\s*\.\s*autoInstallOnAppQuit\s*=\s*true/.test(service) &&
    /private\s+configureRuntime[\s\S]{0,1200}?updater\s*\.\s*allowDowngrade\s*=\s*false/.test(service),
  'AppUpdateService owns download/install/downgrade runtime policy'
);

check(
  /updater\s*\.\s*allowPrerelease\s*=/.test(service) && /updater\s*\.\s*channel\s*=/.test(service),
  'AppUpdateService owns channel and prerelease policy'
);

check(
  !/autoUpdater\s*\.\s*channel\s*=/.test(awareness) &&
    !/autoUpdater\s*\.\s*allowDowngrade\s*=/.test(awareness) &&
    !/autoUpdater\s*\.\s*allowPrerelease\s*=/.test(awareness) &&
    !/autoUpdater\s*\.\s*autoDownload\s*=/.test(awareness) &&
    !/autoUpdater\s*\.\s*autoInstallOnAppQuit\s*=/.test(awareness),
  'startup awareness contains no updater policy/config writes'
);

check(
  /autoUpdater\s*\.\s*checkForUpdates\s*\(\s*\)/.test(awareness) &&
    /setTimeout\s*\(/.test(awareness) &&
    /\b1800\b/.test(awareness),
  'startup awareness keeps automatic startup check'
);

check(
  /['"]update-available['"]/.test(awareness) &&
    /['"]download-progress['"]/.test(awareness) &&
    /['"]update-downloaded['"]/.test(awareness),
  'startup awareness observes update lifecycle'
);

check(
  /new\s+Notification\s*\(/.test(awareness) && awareness.includes('Tubmedia có bản cập nhật mới'),
  'startup awareness provides desktop notification'
);

check(
  /autoUpdater\s*\.\s*downloadUpdate\s*\(\s*\)/.test(awareness) &&
    /autoUpdater\s*\.\s*quitAndInstall\s*\(\s*false\s*,\s*true\s*\)/.test(awareness),
  'startup awareness keeps explicit user download/install actions'
);

check(
  preload.includes('tubmediaUpdateAwareness') &&
    preload.includes('downloadNow') &&
    preload.includes('installNow') &&
    preload.includes('onState'),
  'secure preload bridge remains connected'
);

check(
  renderer.includes('data-tubmedia-update-dot') &&
    renderer.includes('Cập nhật ngay') &&
    renderer.includes('Cài đặt & khởi động lại'),
  'red-dot and one-click update UX remains connected'
);

const mainFiles = walk(path.join(cwd, 'src', 'main'));
const mainSources = mainFiles.map((file) => ({ file, text: read(file) }));

const channelWriters = mainSources.filter(({ text }) =>
  /(?:autoUpdater|updater)\s*\.\s*channel\s*=/.test(text)
);

check(
  channelWriters.length === 1 && path.normalize(channelWriters[0].file) === path.normalize(servicePath),
  'only AppUpdateService writes updater channel'
);

// IMPORTANT: match executable assignments only. Do not flag documentation/comments
// such as: "electron-updater sets allowDowngrade=true whenever channel is assigned."
const explicitDowngradeTrue = mainSources.some(({ text }) =>
  /(?:^|\n)\s*(?:autoUpdater|updater)\s*\.\s*allowDowngrade\s*=\s*true\s*;/m.test(text)
);

check(!explicitDowngradeTrue, 'no executable source assignment enables updater downgrade');

const explicitPrereleaseTrueOutsideService = mainSources.some(
  ({ file, text }) =>
    path.normalize(file) !== path.normalize(servicePath) &&
    /(?:^|\n)\s*(?:autoUpdater|updater)\s*\.\s*allowPrerelease\s*=\s*true\s*;/m.test(text)
);

check(!explicitPrereleaseTrueOutsideService, 'no updater module outside AppUpdateService enables prerelease');

const packageJson = JSON.parse(read(path.join(cwd, 'package.json')));

check(
  packageJson.scripts?.['verify:unified-app-updater'] ===
    'node scripts/verify-unified-app-updater-hotfix15.mjs',
  'unified updater verifier is registered'
);

check(
  typeof packageJson.scripts?.check === 'string' &&
    packageJson.scripts.check.includes('npm run verify:unified-app-updater'),
  'unified updater verification is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`Unified app updater verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia unified app updater verification OK: ${checks} checks.`);
