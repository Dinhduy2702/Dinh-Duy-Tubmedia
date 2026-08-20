import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const updater = fs.readFileSync('src/main/updates/app-update-service.ts', 'utf8');
const gen = fs.readFileSync('scripts/generate-installer-blockmap.mjs', 'utf8');

let checks = 0;
let failures = 0;

const check = (ok, label) => {
  checks += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

check(pkg.version === '1.3.4', 'package version is 1.3.4');
check(updater.includes('TUBMEDIA_V133_DIFFERENTIAL_UPDATE'), 'differential marker exists');
check(
  updater.includes('updater.disableDifferentialDownload = false'),
  'differential downloading explicitly enabled'
);
check(
  !updater.includes('updater.disableDifferentialDownload = true'),
  'no source disables differential downloading'
);
check(
  String(pkg.scripts?.['dist:nsis-safe'] || '').includes('generate-installer-blockmap.mjs'),
  'official build generates blockmap'
);
check(
  pkg.devDependencies?.['app-builder-bin'] === '5.0.0-alpha.12',
  'blockmap compatibility helper is pinned as build-only dependency'
);
const helperResolutionPattern = /require\.resolve\s*\(\s*["']app-builder-bin\/package\.json["']\s*\)/s;

const blockmapInvocationPattern =
  /spawnSync\s*\(\s*appBuilder\s*,\s*\[\s*["']blockmap["']\s*,\s*["']--input["']\s*,\s*installer\s*,\s*["']--output["']\s*,\s*blockmap\s*\]/s;

check(
  helperResolutionPattern.test(gen) && blockmapInvocationPattern.test(gen),
  'blockmap generator resolves the pinned helper deterministically'
);
check(
  String(pkg.scripts?.check || '').includes('npm run verify:differential-updater'),
  'verifier is permanent in npm run check'
);

if (failures) {
  throw new Error(`Differential verifier failed ${failures}/${checks}`);
}

console.log(`Tubmedia differential updater OK: ${checks} checks.`);
