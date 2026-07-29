import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const checks = [];

async function text(relativePath) {
  return readFile(join(root, relativePath), 'utf8');
}

function assert(name, condition) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  checks.push(name);
  console.log(`PASS: ${name}`);
}

function compact(value) {
  return value.replace(/\s+/g, '');
}

const [pkgText, identityText, eslint, normalize, nsis, app, queue, logs, download, mergePage, css, store] =
  await Promise.all([
    text('package.json'),
    text('installer/identity.json'),
    text('eslint.config.js'),
    text('src/main/normalize/normalize-engine.ts'),
    text('installer/video-studio-pro.nsi'),
    text('src/renderer/src/app/App.tsx'),
    text('src/renderer/src/pages/QueuePage.tsx'),
    text('src/renderer/src/pages/LogsPage.tsx'),
    text('src/renderer/src/pages/DownloadWorkbenchPage.tsx'),
    text('src/renderer/src/pages/DownloadMergePage.tsx'),
    text('src/renderer/src/tubmedia-theme.css'),
    text('src/renderer/src/stores/app-store.ts')
  ]);

const pkg = JSON.parse(pkgText);
const identity = JSON.parse(identityText);
assert('UTF-8 installer company identity is stable', pkg.author === identity.companyName);
assert('ESLint ignores generated verification logs', eslint.includes("'verification-logs/**'"));
assert('normalization sends an escaped comma to FFmpeg', normalize.includes('`min(iw\\\\,${target.width})`'));
assert(
  'hardening keeps content-preserving scale',
  normalize.includes('force_original_aspect_ratio=decrease')
);
assert(
  'hardening does not restore automatic crop',
  !normalize.includes('crop=${target.width}:${target.height}')
);
assert('installer finds legacy uninstall identity', nsis.includes('Uninstall\\${LEGACY_APP_ID}'));
assert('installer reuses the previous directory', nsis.includes('StrCpy $INSTDIR "$0"'));
assert(
  'installer skips directory selection during upgrade',
  nsis.includes('MUI_PAGE_CUSTOMFUNCTION_PRE SkipDirectoryPageForUpgrade')
);
assert(
  'installer overwrites application files only after process shutdown',
  nsis.includes('SetOverwrite on')
);
assert(
  'installer has numeric and display version metadata',
  nsis.includes('"FileVersion" "${PRODUCT_VERSION}"')
);
assert('diagnostic dock remains mounted', /<DiagnosticDock\s*\/>/.test(app));
assert(
  'queue compact badge survives formatter changes',
  compact(queue).includes('<StatusBadgestatus={job.status}fixed/>')
);
assert(
  'logs compact badge survives formatter changes',
  compact(logs).includes('<StatusBadgestatus={entry.level}fixed/>')
);
assert(
  'download compact rows survive formatter changes',
  compact(download).includes('<CompactLogRowkey={entry.id}entry={entry}/>')
);
assert(
  'merge compact rows survive formatter changes',
  compact(mergePage).includes('<CompactLogRowkey={entry.id}entry={entry}/>')
);
assert(
  'main scrollbar style exists independently of whitespace',
  /\.app-main::-webkit-scrollbar\s*\{\s*width:\s*13px/.test(css)
);
assert('merge error panel style exists independently of whitespace', /\.merge-error-detail\s*\{/.test(css));

const readyIndex = store.indexOf('ready: true');
const logsMatch = /window\.desktop\.logs\s*\.list\(\{\s*limit:\s*100\s*\}\)/.exec(store);
const hardwareMatch = /window\.desktop\.settings\s*\.hardware\(\)/.exec(store);
assert(
  'workspace becomes ready before historical logs load',
  readyIndex >= 0 && logsMatch && logsMatch.index > readyIndex
);
assert(
  'workspace becomes ready before full hardware discovery',
  readyIndex >= 0 && hardwareMatch && hardwareMatch.index > readyIndex
);

console.log(`Validation gate fixes OK: ${checks.length} checks.`);
