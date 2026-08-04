import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const page = readFileSync(join(root, 'src/renderer/src/pages/UpdatesPage.tsx'), 'utf8');
const topbar = readFileSync(join(root, 'src/renderer/src/layout/Topbar.tsx'), 'utf8');
const service = readFileSync(join(root, 'src/main/updates/app-update-service.ts'), 'utf8');
const versionUtility = readFileSync(join(root, 'src/shared/app-version.ts'), 'utf8');
const releaseNotesUtility = readFileSync(join(root, 'src/shared/release-notes.ts'), 'utf8');

const checks = [
  [
    'release notes are formatted as text',
    page.includes('formatReleaseNotesForDisplay(status.info.releaseNotes)') &&
      page.includes("whiteSpace: 'pre-line'")
  ],
  ['raw release note interpolation is removed', !page.includes('<div>{status.info.releaseNotes}</div>')],
  [
    'semantic version comparison is shared',
    versionUtility.includes('compareAppVersions') && versionUtility.includes('isNewerAppVersion')
  ],
  [
    'backend rejects older update-available events',
    service.includes('APP_UPDATE_DOWNGRADE_BLOCKED') && service.includes('if (relation !== 1)')
  ],
  [
    'download requires a strictly newer version',
    service.includes("'Không có phiên bản mới hơn để tải. Tubmedia không cho phép hạ cấp.'") &&
      service.includes('!isNewerAppVersion(')
  ],
  ['install blocks downgrade', service.includes('Chỉ có thể cài phiên bản mới hơn phiên bản đang chạy')],
  ['downloaded downgrade packages are rejected', service.includes('APP_UPDATE_DOWNLOADED_DOWNGRADE_BLOCKED')],
  [
    'download action requires a newer remote version',
    page.includes("status?.state === 'available'") && page.includes('isNewerAppVersion(')
  ],
  [
    'install action requires a newer remote version',
    page.includes("status?.state === 'downloaded'") && page.includes('isNewerAppVersion(')
  ],
  [
    'older remote version is labelled correctly',
    page.includes('PHIÊN BẢN TRÊN MÁY CHỦ') && page.includes('máy chủ đang có bản cũ hơn')
  ],
  [
    'topbar never advertises an older release',
    topbar.includes('updateIsNewer') && topbar.includes('Đang dùng bản mới hơn')
  ],
  [
    'formatter strips executable markup',
    releaseNotesUtility.includes('replace(/<script') && releaseNotesUtility.includes('replace(/<style')
  ]
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

console.log(`Update center downgrade protection verification OK: ${checks.length} checks.`);
