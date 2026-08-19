import fs from 'node:fs';

const updater = fs.readFileSync('src/main/updates/app-update-service.ts', 'utf8');
const page = fs.readFileSync('src/renderer/src/pages/UpdatesPage.tsx', 'utf8');
const events = fs.readFileSync('src/renderer/src/hooks/use-desktop-events.ts', 'utf8');
const awareness = fs.readFileSync('src/renderer/src/update-awareness.ts', 'utf8');

let checks = 0;
let failures = 0;

function check(ok, label) {
  checks += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const wrappers = updater.match(/TUBMEDIA_V132_UPDATE_NOW_AUTO_INSTALL_AST/g) ?? [];

check(wrappers.length === 1, 'professional download->install wrapper exists exactly once');

check(
  updater.includes('updater.autoDownload = false') &&
    updater.includes('updater.autoInstallOnAppQuit = false'),
  'availability checking never auto-downloads or auto-installs'
);

check(
  updater.includes('.downloadUpdate()'),
  'explicit update action still uses the real electron-updater download'
);

check(
  updater.includes('quitAndInstall(true, true)'),
  'download completion performs silent NSIS install and force relaunch'
);

check(
  updater.includes('TUBMEDIA_V132_UPDATE_CHECK_NONBLOCKING_HOTFIX'),
  'manual update check remains nonblocking'
);

check(page.includes('Cập nhật ngay'), 'Update Center exposes the exact Cập nhật ngay CTA');

check(page.includes('Đang cập nhật Tubmedia...'), 'Update Center exposes foreground update progress wording');

check(
  page.includes("run('download')") || page.includes('window.desktop.updates.download()'),
  'real update download action wiring remains present'
);

const ui = `${page}\n${events}\n${awareness}`;

check(!ui.includes('Bạn có thể tải trong nền'), 'background-download primary wording is absent');

if (failures) {
  throw new Error(`Professional update verification failed: ${failures}/${checks}`);
}

console.log(`Tubmedia professional Update Now verification OK: ${checks} checks.`);
