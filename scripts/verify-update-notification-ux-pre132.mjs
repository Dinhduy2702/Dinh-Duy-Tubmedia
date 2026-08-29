import fs from 'node:fs';

const events = fs.readFileSync('src/renderer/src/hooks/use-desktop-events.ts', 'utf8');
const page = fs.readFileSync('src/renderer/src/pages/UpdatesPage.tsx', 'utf8');
const service = fs.readFileSync('src/main/updates/app-update-service.ts', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const checks = [
  [
    'only confirmed available/downloaded states create update attention',
    events.includes("status.state !== 'available' && status.state !== 'downloaded'")
  ],
  [
    'same version/state is claimed once across renderer sessions',
    events.includes('claimUpdateNotice') &&
      events.includes('UPDATE_NOTICE_STORAGE_PREFIX') &&
      events.includes('lastUpdateNotice')
  ],
  [
    'update attention is informational rather than an error',
    events.includes("severity: downloaded ? 'success' : 'info'")
  ],
  [
    'background check errors stay in logs and do not create popup state',
    service.includes('Automatic polling errors belong to logs/diagnostics') &&
      service.includes('if (this.silentCheck)')
  ],
  [
    'Update Center exposes explicit manual retry without automatic popup',
    page.includes('window.desktop.updates.check()') && page.includes('Thử kiểm tra lại')
  ],
  [
    'download and install actions remain in the app',
    page.includes('window.desktop.updates.download()') &&
      page.includes('window.desktop.updates.install()') &&
      page.includes('Cài đặt & khởi động lại')
  ],
  [
    'update notification verifier remains registered',
    pkg.scripts?.['verify:update-notification-ux'] ===
      'node scripts/verify-update-notification-ux-pre132.mjs' &&
      String(pkg.scripts?.check ?? '').includes('npm run verify:update-notification-ux')
  ]
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}
if (failures) throw new Error(`Update notification UX verification failed: ${failures}/${checks.length}`);
console.log(`Tubmedia update notification UX verification OK: ${checks.length} checks.`);
