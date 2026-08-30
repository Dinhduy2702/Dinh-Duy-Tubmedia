import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const read = (file) => fs.readFileSync(file, 'utf8');

function walk(root) {
  const files = [];

  if (!fs.existsSync(root)) {
    return files;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }

    if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs|html)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function resolveRelativeModule(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base];

  if (specifier.endsWith('.js')) {
    const stem = base.slice(0, -3);

    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${stem}.cjs`);
  } else {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.cjs`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
      path.join(base, 'index.js')
    );
  }

  return candidates.some((candidate) => fs.existsSync(candidate));
}

let checks = 0;
let failures = 0;

function check(condition, label) {
  checks += 1;

  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${label}`);
  }
}

const pkg = JSON.parse(read(path.join(cwd, 'package.json')));

const mainIndexPath = path.join(cwd, 'src', 'main', 'index.ts');
const servicePath = path.join(cwd, 'src', 'main', 'updates', 'app-update-service.ts');
const updateEventsPath = path.join(cwd, 'src', 'renderer', 'src', 'hooks', 'use-desktop-events.ts');
const rendererHtmlPath = path.join(cwd, 'src', 'renderer', 'index.html');
const securityGuardPath = path.join(cwd, 'src', 'main', 'runtime', 'electron-security-guard.ts');
const downloadEnginePath = path.join(cwd, 'src', 'main', 'downloader', 'download-engine.ts');

const mainIndex = read(mainIndexPath);
const service = read(servicePath);
const updateEvents = read(updateEventsPath);
const rendererHtml = read(rendererHtmlPath);
const securityGuard = read(securityGuardPath);
const downloadEngine = read(downloadEnginePath);

const mainFiles = walk(path.join(cwd, 'src', 'main'));
const mainFileSources = mainFiles.map((file) => ({
  file,
  text: read(file)
}));

const mainSources = mainFileSources.map(({ text }) => text).join('\n');
const rendererFiles = walk(path.join(cwd, 'src', 'renderer'));
const rendererSources = rendererFiles.map(read).join('\n');
const preloadFiles = walk(path.join(cwd, 'src', 'preload'));
const preloadSources = preloadFiles.map(read).join('\n');

const applicationSources = `${mainSources}\n${rendererSources}\n${preloadSources}`;

check(pkg.version === '1.3.6', 'v1.3.6 audit keeps application version 1.3.6');

check(pkg.devDependencies?.electron === '43.2.0', 'Electron is pinned to 43.2.0');

check(
  pkg.dependencies?.['electron-updater'] === '6.8.9' || pkg.devDependencies?.['electron-updater'] === '6.8.9',
  'electron-updater is pinned to 6.8.9'
);

check(pkg.devDependencies?.['electron-builder'] === '26.15.4', 'electron-builder is pinned to 26.15.4');

check(pkg.overrides?.['js-yaml'] === '5.2.3', 'transitive js-yaml security override is pinned to 5.2.3');

check(
  !pkg.dependencies?.['extract-zip'] && !pkg.devDependencies?.['extract-zip'],
  'vulnerable direct extract-zip dependency remains absent'
);

check(
  pkg.dependencies?.['@tubmedia/safe-extract-zip'] || pkg.devDependencies?.['@tubmedia/safe-extract-zip'],
  'safe ZIP adapter dependency remains installed'
);

const singleInstanceImplementations = mainFileSources.filter(({ text }) =>
  /requestSingleInstanceLock\s*\(/.test(text)
);

check(
  singleInstanceImplementations.length === 1,
  'exactly one main-process single-instance lock implementation exists'
);

check(
  singleInstanceImplementations.length === 1 && /second-instance/.test(singleInstanceImplementations[0].text),
  'single-instance implementation handles a second launch'
);

check(
  singleInstanceImplementations.length === 1 &&
    /(focus\s*\(\s*\)|show\s*\(\s*\)|restore\s*\(\s*\))/.test(singleInstanceImplementations[0].text),
  'second launch restores/shows/focuses the primary app'
);

const phantomSingleInstanceImport = /import\s+['"]\.\/runtime\/single-instance-guard\.js['"]/.test(mainIndex);

check(!phantomSingleInstanceImport, 'single-instance wiring contains no phantom dedicated-guard import');

const relativeSideEffectImports = [];

for (const { file, text } of mainFileSources) {
  const regex = /^\s*import\s+['"](\.[^'"]+)['"]\s*;.*$/gm;

  for (const match of text.matchAll(regex)) {
    relativeSideEffectImports.push({
      file,
      specifier: match[1]
    });
  }
}

const danglingSideEffectImports = relativeSideEffectImports.filter(
  ({ file, specifier }) => !resolveRelativeModule(file, specifier)
);

if (danglingSideEffectImports.length > 0) {
  console.log('dangling main side-effect imports:', danglingSideEffectImports);
}

check(
  danglingSideEffectImports.length === 0,
  'main-process relative side-effect imports all resolve to real source modules'
);

check(
  /electron-security-guard/.test(mainIndex) &&
    /setWindowOpenHandler/.test(securityGuard) &&
    /will-navigate/.test(securityGuard) &&
    /will-attach-webview/.test(securityGuard),
  'Electron popup/navigation/webview security boundary is installed'
);

check(
  /protocol\s*===\s*['"]https:['"]/.test(securityGuard),
  'external links opened by the security guard are HTTPS-only'
);

check(
  !/\bnodeIntegration\s*:\s*true\b/.test(mainSources) &&
    !/\bcontextIsolation\s*:\s*false\b/.test(mainSources) &&
    !/\bwebSecurity\s*:\s*false\b/.test(mainSources) &&
    !/\ballowRunningInsecureContent\s*:\s*true\b/.test(mainSources),
  'no explicit insecure BrowserWindow preference remains'
);

check(
  /Content-Security-Policy/i.test(rendererHtml) && /object-src 'none'/.test(rendererHtml),
  'renderer has a restrictive Content-Security-Policy'
);

check(
  !/(?:^|\W)(?:eval|new\s+Function)\s*\(/m.test(applicationSources),
  'application source contains no direct eval/new Function execution'
);

check(
  !/exposeInMainWorld\s*\([^)]*ipcRenderer/s.test(preloadSources),
  'preload never exposes raw ipcRenderer through contextBridge'
);

const privilegedRendererImports = rendererFiles.some((file) => {
  if (!/\.(?:ts|tsx|js|jsx)$/.test(file)) {
    return false;
  }

  return /(?:from\s+['"]electron['"]|require\s*\(\s*['"]electron['"])/.test(read(file));
});

check(!privilegedRendererImports, 'renderer does not import privileged Electron APIs directly');

check(
  /updater\s*\.\s*channel\s*=\s*channel\s*;[\s\S]{0,500}?updater\s*\.\s*allowDowngrade\s*=\s*false\s*;/.test(
    service
  ),
  'updater channel changes always re-lock downgrade protection'
);

check(
  !fs.existsSync(path.join(cwd, 'src', 'main', 'update', 'startup-update-awareness.ts')) &&
    !fs.existsSync(path.join(cwd, 'src', 'preload', 'update-awareness-bridge.ts')) &&
    !fs.existsSync(path.join(cwd, 'src', 'renderer', 'src', 'update-awareness.ts')),
  'legacy parallel startup updater remains removed'
);

check(
  /networkCheckInFlight/.test(service) &&
    /claimUpdateNotice/.test(updateEvents) &&
    /lastUpdateNotice/.test(updateEvents),
  'update checks are coalesced and version notices are deduplicated'
);

check(
  /app\.isPackaged/.test(service) &&
    /startUpdateScheduler/.test(mainIndex) &&
    /6\s*\*\s*60\s*\*\s*60\s*\*\s*1_000/.test(mainIndex),
  'update checks are packaged-only with bounded startup and periodic cadence'
);

check(
  !/youtube:player[_-]client\s*=\s*web_safari/.test(downloadEngine) &&
    /--concurrent-fragments/.test(downloadEngine) &&
    /--no-cache-dir/.test(downloadEngine) &&
    !/['"]--format-sort['"][\s\S]{0,100}?['"]proto:m3u8['"]/.test(downloadEngine),
  'YouTube recovery avoids unstable web_safari and reduces fragment pressure on retry'
);

const requiredTests = [
  'tests/unit/app-update-version.test.ts',
  'tests/unit/installer-upgrade.test.ts',
  'tests/unit/release-update-system.test.ts',
  'tests/unit/download-recovery-r49.test.ts',
  'tests/unit/merge-checkpoint-ownership-hotfix13.test.ts',
  'tests/unit/timeline-merge-recovery-hotfix12.test.ts',
  'tests/unit/temporary-cleanup.test.ts',
  'tests/unit/system-cleanup-policy.test.ts',
  'tests/unit/job-state-machine.test.ts',
  'tests/unit/disk-full-recovery.test.ts',
  'tests/integration/database.test.ts',
  'tests/e2e/app.spec.ts'
];

check(
  requiredTests.every((relative) => fs.existsSync(path.join(cwd, relative))),
  'release-critical update/recovery/database/cleanup/E2E tests are present'
);

check(
  pkg.scripts?.['verify:pre132-user-release'] === 'node scripts/verify-pre132-user-release.mjs',
  'v1.3.6 user release verifier is registered'
);

check(
  typeof pkg.scripts?.check === 'string' && pkg.scripts.check.includes('npm run verify:pre132-user-release'),
  'v1.3.6 user release verification is permanent in npm run check'
);

check(
  pkg.scripts?.['verify:safe-zip-extraction'] === 'node scripts/verify-safe-zip-extraction-pre132.mjs' &&
    pkg.scripts?.['verify:js-yaml-security'] === 'node scripts/verify-js-yaml-security-pre132.mjs',
  'safe ZIP and js-yaml security verifiers remain registered'
);

if (failures > 0) {
  throw new Error(`Pre-1.3.6 user release verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia v1.3.6 user release verification OK: ${checks} checks.`);
