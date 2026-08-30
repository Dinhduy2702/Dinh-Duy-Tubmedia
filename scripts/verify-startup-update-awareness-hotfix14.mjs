import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const main = read('src/main/index.ts');
const service = read('src/main/updates/app-update-service.ts');
const preload = read('src/preload/index.ts');
const events = read('src/renderer/src/hooks/use-desktop-events.ts');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['AppUpdateService policy module exists', exists('src/main/updates/app-update-service.ts')],
  [
    'duplicate legacy startup updater is removed',
    !exists('src/main/update/startup-update-awareness.ts') &&
      !exists('src/preload/update-awareness-bridge.ts') &&
      !exists('src/renderer/src/update-awareness.ts')
  ],
  [
    'packaged app checks silently after startup and every six hours',
    main.includes('runBackgroundUpdateChecks') &&
      main.includes('startUpdateScheduler') &&
      /6\s*\*\s*60\s*\*\s*60\s*\*\s*1_000/.test(main)
  ],
  [
    'startup check obeys user setting',
    main.includes('autoCheckAppUpdates') && main.includes('appUpdates.check(true)')
  ],
  [
    'canonical updater never auto downloads or installs on quit',
    service.includes('updater.autoDownload = false') &&
      service.includes('updater.autoInstallOnAppQuit = false') &&
      service.includes('updater.allowDowngrade = false')
  ],
  [
    'canonical preload and renderer carry update state',
    preload.includes('updates:') &&
      preload.includes('onUpdateStatus') &&
      events.includes('onUpdateStatus(updateStatus)')
  ],
  [
    'update notices are version claimed and deduplicated',
    events.includes('claimUpdateNotice') && events.includes('lastUpdateNotice')
  ],
  [
    'startup update verifier remains registered',
    pkg.scripts?.['verify:startup-update-awareness'] ===
      'node scripts/verify-startup-update-awareness-hotfix14.mjs' &&
      String(pkg.scripts?.check ?? '').includes('npm run verify:startup-update-awareness')
  ]
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}
if (failures) throw new Error(`Startup update verification failed: ${failures}/${checks.length}`);
console.log(`Tubmedia canonical startup update verification OK: ${checks.length} checks.`);
