import fs from 'node:fs';

const main = fs.readFileSync('src/main/updates/app-update-service.ts', 'utf8');
const ui = fs.readFileSync('src/renderer/src/pages/UpdatesPage.tsx', 'utf8');

const checks = [
  [main.includes('TUBMEDIA_V132_UPDATE_CHECK_NONBLOCKING_HOTFIX'), 'main updater nonblocking marker exists'],
  [
    main.includes('void this.waitForNetworkCheck(transport, timeoutMs).then'),
    'main updater watchdog runs without awaiting the network request'
  ],
  [
    !main.includes('const completed = await this.waitForNetworkCheck(transport, timeoutMs)'),
    'old blocking manual check await is removed'
  ],
  [
    main.includes('Bạn vẫn có thể tiếp tục sử dụng Tubmedia'),
    'timeout path explicitly keeps the workspace usable'
  ],
  [main.includes('if (this.networkCheckInFlight)'), 'duplicate network checks remain coalesced'],
  [
    ui.includes('TUBMEDIA_V132_UPDATE_UI_WATCHDOG_HOTFIX'),
    'renderer has an independent update-check watchdog'
  ],
  [ui.includes('UPDATE_CHECK_UI_TIMEOUT_MS = 12_000'), 'renderer watchdog is bounded at twelve seconds'],
  [
    ui.includes('withUpdateUiTimeout(') && ui.includes('window.desktop.updates.check()'),
    'manual check IPC is wrapped by the UI watchdog'
  ],
  [ui.includes('} finally {') && ui.includes('setBusy(null);'), 'renderer always releases the busy state']
];

let failed = 0;

for (const [ok, label] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failed += 1;
}

if (failed) {
  throw new Error(`Update nonblocking hotfix verifier failed: ${failed}/${checks.length}`);
}

console.log(`Tubmedia update nonblocking hotfix OK: ${checks.length} checks.`);
