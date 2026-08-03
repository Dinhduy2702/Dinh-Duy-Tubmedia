import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const panel = readFileSync(join(root, 'src/renderer/src/components/QuickDownloadPanel.tsx'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const checks = [];

function check(label, condition) {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }

  checks.push(label);
  console.log(`PASS: ${label}`);
}

check('version remains 1.3.0', packageJson.version === '1.3.0');

check(
  'start duration is restored',
  panel.includes('tubmedia.quick-download.start-duration') && panel.includes('window.localStorage.getItem')
);

check(
  'end duration is restored',
  panel.includes('tubmedia.quick-download.end-duration') && panel.includes('window.localStorage.getItem')
);

check('duration changes are saved', panel.includes('window.localStorage.setItem'));

check('start duration is never reset to default', !/setStartTime\(\s*['"](?:00:)?10:00['"]\s*\)/.test(panel));

check('end duration is never reset to default', !/setEndTime\(\s*['"](?:00:)?13:00['"]\s*\)/.test(panel));

check('hours above 23 remain supported', panel.includes('^\\d{2,4}:[0-5]\\d:[0-5]\\d$'));

console.log(`Duration persistence verification OK: ${checks.length} checks.`);
