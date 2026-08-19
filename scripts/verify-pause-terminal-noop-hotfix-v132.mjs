import fs from 'node:fs';

const source = fs.readFileSync('src/main/queue/queue-manager.ts', 'utf8');

const checks = [
  [source.includes('TUBMEDIA_V132_PAUSE_TERMINAL_NOOP_HOTFIX'), 'pause terminal no-op marker exists'],
  [
    source.includes('if (TERMINAL_STATUSES.has(before.status))'),
    'pause returns safely for terminal state before invalid rejection'
  ],
  [
    source.includes('TUBMEDIA_V132_PAUSE_PROJECT_TERMINAL_RACE_HOTFIX'),
    'pauseProject terminal race marker exists'
  ],
  [source.includes('TUBMEDIA_V132_PAUSE_ALL_TERMINAL_RACE_HOTFIX'), 'pauseAll terminal race marker exists'],
  [source.includes('PROJECT_PAUSE_NOOP'), 'project no-op path preserves terminal jobs']
];

let failed = 0;

for (const [ok, label] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failed += 1;
}

if (failed) {
  throw new Error(`Pause terminal hotfix verifier failed: ${failed}/${checks.length}`);
}

console.log(`Tubmedia pause terminal hotfix OK: ${checks.length} checks.`);
