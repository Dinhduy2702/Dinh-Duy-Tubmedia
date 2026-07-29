import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const page = readFileSync(join(root, 'src/renderer/src/pages/UpdatesPage.tsx'), 'utf8');
const utility = readFileSync(join(root, 'src/shared/release-notes.ts'), 'utf8');

const checks = [
  [
    'release notes are formatted as text',
    page.includes('formatReleaseNotesForDisplay(status.info.releaseNotes)') &&
      (page.includes("whiteSpace: 'pre-line'") || page.includes('whiteSpace: "pre-line"'))
  ],
  ['raw release note interpolation is removed', !page.includes('<div>{status.info.releaseNotes}</div>')],
  ['download action is hidden when unavailable', page.includes('{canDownload &&')],
  ['install action is hidden until downloaded', page.includes('{canInstall &&')],
  [
    'formatter strips executable markup',
    utility.includes('replace(/<script') && utility.includes('replace(/<style')
  ]
];

for (const [name, ok] of checks) {
  if (!ok) {
    throw new Error(`FAIL: ${name}`);
  }

  console.log(`PASS: ${name}`);
}

console.log(`Update center UI verification OK: ${checks.length} checks.`);
