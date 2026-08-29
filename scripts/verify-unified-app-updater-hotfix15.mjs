import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const servicePath = path.join(root, 'src/main/updates/app-update-service.ts');
const service = fs.readFileSync(servicePath, 'utf8');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

const mainSources = walk(path.join(root, 'src/main')).map((file) => ({
  file,
  text: fs.readFileSync(file, 'utf8')
}));
const updaterOwners = mainSources.filter(({ text }) =>
  /(?:from\s+['"]electron-updater['"]|requireFromEsm\(['"]electron-updater['"]\))/.test(text)
);
const channelWriters = mainSources.filter(({ text }) => /\bupdater\s*\.\s*channel\s*=/.test(text));
const pkg = JSON.parse(read('package.json'));

const checks = [
  [
    'only AppUpdateService loads electron-updater',
    updaterOwners.length === 1 && path.normalize(updaterOwners[0].file) === path.normalize(servicePath)
  ],
  [
    'only AppUpdateService writes update channel',
    channelWriters.length === 1 && path.normalize(channelWriters[0].file) === path.normalize(servicePath)
  ],
  [
    'runtime policy is manual download, manual silent install and no downgrade',
    service.includes('updater.autoDownload = false') &&
      service.includes('updater.autoInstallOnAppQuit = false') &&
      service.includes('updater.allowDowngrade = false')
  ],
  [
    'channel assignment is followed by downgrade lock',
    /updater\.channel\s*=\s*channel;[\s\S]{0,350}?updater\.allowDowngrade\s*=\s*false;/.test(service)
  ],
  [
    'download never invokes installer',
    /public async download\(\)[\s\S]*?public async install\(\)/.test(service) &&
      !/public async download\(\)[\s\S]*?quitAndInstall[\s\S]*?public async install\(\)/.test(service)
  ],
  [
    'only explicit install performs silent force-run update',
    (service.match(/quitAndInstall\(true, true\)/g) ?? []).length === 1 &&
      /public async install\(\)[\s\S]*?quitAndInstall\(true, true\)/.test(service)
  ],
  [
    'legacy parallel updater files remain absent',
    !fs.existsSync(path.join(root, 'src/main/update/startup-update-awareness.ts')) &&
      !fs.existsSync(path.join(root, 'src/preload/update-awareness-bridge.ts')) &&
      !fs.existsSync(path.join(root, 'src/renderer/src/update-awareness.ts'))
  ],
  [
    'unified updater verifier remains registered',
    pkg.scripts?.['verify:unified-app-updater'] === 'node scripts/verify-unified-app-updater-hotfix15.mjs' &&
      String(pkg.scripts?.check ?? '').includes('npm run verify:unified-app-updater')
  ]
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}
if (failures) throw new Error(`Unified app updater verification failed: ${failures}/${checks.length}`);
console.log(`Tubmedia unified app updater verification OK: ${checks.length} checks.`);
