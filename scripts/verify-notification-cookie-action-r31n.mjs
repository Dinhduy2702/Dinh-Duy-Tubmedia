import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const text = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let checks = 0;
let failures = 0;
const check = (ok, name) => {
  checks += 1;
  if (ok) console.log('PASS: ' + name);
  else {
    failures += 1;
    console.error('FAIL: ' + name);
  }
};

const hook = text('src/renderer/src/hooks/use-desktop-events.ts');
const center = text('src/renderer/src/components/AttentionCenter.tsx');
const dialog = text('src/renderer/src/components/CookieManagerDialog.tsx');
const pkg = JSON.parse(text('package.json'));

check(
  hook.includes('TUBMEDIA_R31N_NOTIFICATION_SPAM_COOKIE_ACTION'),
  'R31N central notification marker exists'
);
check(hook.includes("id: 'cookie-blocker:global'"), 'cookie blockers use one stable global attention id');
check(
  hook.includes('store.dismissAttentionByCodes(COOKIE_BLOCKING_CODES_R31N)'),
  'old cookie blocker notices are coalesced before replacement'
);
check(
  hook.includes("code: 'AUTHENTICATION_REQUIRED'"),
  'global cookie notice uses the shared cookie-blocking equivalence class'
);
check(
  !hook.includes('projectId: undefined') &&
    !hook.includes('jobId: undefined') &&
    hook.includes("id: 'cookie-blocker:global'"),
  'global cookie action omits job/list ownership fields under exactOptionalPropertyTypes'
);
check(
  hook.includes('return;') && hook.includes('COOKIE_BLOCKING_CODES_R31N.includes'),
  'cookie events exit before normal final-failure batching'
);
check(
  center.includes('TUBMEDIA_R31N_NOTIFICATION_SPAM_COOKIE_ACTION'),
  'AttentionCenter cookie action marker exists'
);
check(
  center.includes('import { CookieManagerDialog }') && center.includes('./' + 'CookieManagerDialog'),
  'notification reuses shared CookieManagerDialog'
);
check(
  center.includes('Th' + String.fromCharCode(0x00ea) + 'm Cookies'),
  'cookie notification exposes exact Vietnamese Add Cookies CTA'
);
check(center.includes('setCookieOpen(true)'), 'cookie CTA opens the dialog');
const r31nText = hook + '\n' + center;
check(
  !r31nText.includes(String.fromCharCode(0x00c3)) &&
    !r31nText.includes(String.fromCharCode(0x00c2)) &&
    !r31nText.includes(String.fromCharCode(0x00e2) + String.fromCharCode(0x20ac)),
  'R31N source contains no common UTF-8/ANSI mojibake markers'
);
check(
  center.includes('<CookieManagerDialog open={cookieOpen}'),
  'shared three-method cookie dialog is mounted by AttentionCenter'
);
check(
  dialog.includes('dismissAttentionByCodes(COOKIE_BLOCKING_CODES)'),
  'saving cookies clears cookie blockers'
);
check(dialog.includes('await refreshJobs()'), 'saving cookies refreshes queue state');
check(dialog.includes('onConfigured?.()'), 'existing cookie continuation callback remains intact');
check(
  typeof pkg.scripts?.['verify:r18-adaptive-batch'] === 'string',
  'R18 batch notification verifier remains registered'
);
check(
  typeof pkg.scripts?.['verify:notification-cookie-upgrade'] === 'string',
  'existing cookie auto-resume verifier remains registered'
);
check(
  String(pkg.scripts?.check ?? '').includes('verify:notification-cookie-upgrade'),
  'existing cookie auto-resume verifier is permanent in npm run check'
);
check(
  String(pkg.scripts?.check ?? '').includes('verify:notification-cookie-action'),
  'R31N verifier is permanent in npm run check'
);

if (failures) throw new Error(`R31N notification/cookie verification failed: ${failures}/${checks}`);
console.log(`Tubmedia R31N notification/cookie verification OK: ${checks} checks.`);
