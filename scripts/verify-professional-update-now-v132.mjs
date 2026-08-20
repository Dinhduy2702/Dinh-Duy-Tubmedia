import fs from 'node:fs';

const main = fs.readFileSync('src/main/updates/app-update-service.ts', 'utf8');
const page = fs.readFileSync('src/renderer/src/pages/UpdatesPage.tsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

let checks = 0;
let failures = 0;

function check(ok, label) {
  checks += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const quitInstallMatches = main.match(/quitAndInstall\s*\(\s*true\s*,\s*true\s*\)/g) ?? [];

const automaticInstallMarkers = main.match(/TUBMEDIA_V132_UPDATE_NOW_AUTO_INSTALL_AST/g) ?? [];

check(
  quitInstallMatches.length >= 1 && quitInstallMatches.length <= 2 && automaticInstallMarkers.length === 1,
  'professional silent install/relaunch contract has one owned wrapper and bounded install paths'
);

check(
  main.includes('updater.autoDownload = false') && main.includes('updater.autoInstallOnAppQuit = false'),
  'availability checks never auto-download or auto-install'
);

check(main.includes('downloadUpdate()'), 'explicit update action uses the real electron-updater download');

check(
  main.includes('quitAndInstall(true, true)'),
  'download completion performs silent NSIS install and force relaunch'
);

check(
  main.includes('TUBMEDIA_V133_PASSIVE_UPDATE_CENTER') &&
    !/baseStatus\('checking'[\s\S]{0,180}this\.emit/s.test(main),
  'background update checks are passive instead of exposing a manual checking state'
);

check(
  page.includes('TUBMEDIA_V133_PROFESSIONAL_PASSIVE_UPDATE_CENTER') &&
    !page.includes('Kiểm tra ngay') &&
    !page.includes('updates.check()'),
  'Update Center intentionally exposes no manual check action'
);

check(page.includes('Cập nhật ngay'), 'Update Center exposes the exact Cập nhật ngay CTA');

check(
  page.includes("state === 'downloading'") &&
    page.includes('Đang tải {Math.round(progress)}%') &&
    page.includes('bytes(status?.progress?.bytesPerSecond)'),
  'Update Center exposes real foreground download percent, bytes and speed'
);

check(
  page.includes('window.desktop.updates.download()'),
  'real update download action wiring remains present'
);

check(
  page.includes("state === 'downloaded'") &&
    page.includes('Cài đặt & khởi động lại') &&
    page.includes('window.desktop.updates.install()'),
  'downloaded update exposes explicit install and restart action'
);

check(
  !page.includes('Tải trong nền') &&
    !page.includes('Đang tải bản cập nhật trong nền') &&
    !main.includes("message: 'Đang tải bản cập nhật trong nền...'"),
  'background-download primary wording is absent'
);

check(
  page.includes('PHIÊN BẢN HIỆN TẠI') &&
    page.includes('PHIÊN BẢN MỚI NHẤT') &&
    page.includes('Đã có phiên bản mới'),
  'Update Center uses professional current/latest/new-release presentation'
);

check(
  String(pkg.scripts?.check || '').includes('npm run verify:professional-update-now'),
  'professional update-now verifier remains permanent in npm run check'
);

if (failures) {
  throw new Error(`Professional update verification failed: ${failures}/${checks}`);
}

console.log(`Tubmedia professional passive Update Now verification OK: ${checks} checks.`);
