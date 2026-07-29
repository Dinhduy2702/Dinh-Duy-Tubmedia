import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const required = [
  'src/shared/quick-download.ts',
  'src/main/download/quick-download-command.ts',
  'src/main/download/quick-download-service.ts',
  'src/renderer/src/components/QuickDownloadPanel.tsx',
  'src/renderer/src/quick-download.css',
  'tests/unit/quick-download.test.ts'
];

for (const relative of required) {
  if (!existsSync(join(root, relative))) {
    throw new Error(`Thiếu file tải nhanh: ${relative}`);
  }
}

function read(relative) {
  return readFileSync(join(root, relative), 'utf8');
}

const channels = read('src/shared/contracts/channels.ts');
const schemas = read('src/shared/schemas/ipc.ts');
const registerIpc = read('src/main/ipc/register-ipc.ts');
const preload = read('src/preload/index.ts');
const apiTypes = read('src/preload/api-types.ts');
const downloadPage = read('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
const shared = read('src/shared/quick-download.ts');
const command = read('src/main/download/quick-download-command.ts');

const checks = [
  [
    'quick download channels use the shared IPC contract',
    /quickDownload\s*:/.test(channels) && /["']quick-download:start["']/.test(channels)
  ],
  [
    'quick download request is validated by zod',
    schemas.includes('quickDownloadRequestSchema') && schemas.includes('quickDownloadTaskSchema')
  ],
  [
    'main registers quick download handlers',
    /new\s+QuickDownloadService\s*\(/.test(registerIpc) && registerIpc.includes('IPC.quickDownload.start')
  ],
  [
    'preload exposes quick download inside window.desktop',
    /quickDownload\s*:/.test(preload) && /quickDownload\s*:/.test(apiTypes)
  ],
  ['download page renders quick panel', /<QuickDownloadPanel\b/.test(downloadPage)],
  ['request accepts only HTTP/HTTPS', /\[\s*["']http:["']\s*,\s*["']https:["']\s*\]/.test(shared)],
  ['range download uses yt-dlp sections', /["']--download-sections["']/.test(command)],
  [
    'accurate cuts are opt-in',
    command.includes('request.accurateCut') && /["']--force-keyframes-at-cuts["']/.test(command)
  ],
  ['single URL never expands playlists', /["']--no-playlist["']/.test(command)],
  ['filename contains video id and task token', command.includes('%(id)s') && command.includes('QD-')]
];

for (const [name, ok] of checks) {
  if (!ok) {
    throw new Error(`FAIL: ${name}`);
  }

  console.log(`PASS: ${name}`);
}

console.log(`Quick download integration verification OK: ${checks.length} checks.`);
