import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const cwd = process.cwd();
const rootRequire = createRequire(path.join(cwd, 'package.json'));

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

function findPackageJson(startFile) {
  let current = path.dirname(startFile);

  for (;;) {
    const candidate = path.join(current, 'package.json');

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error(`package.json not found above ${startFile}`);
    }

    current = parent;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));

check(pkg.overrides?.['js-yaml'] === '5.2.3', 'package.json pins transitive js-yaml to 5.2.3');

const updaterPackagePath = rootRequire.resolve('electron-updater/package.json');
const updaterRequire = createRequire(updaterPackagePath);
const jsYamlEntry = updaterRequire.resolve('js-yaml');
const jsYamlPackagePath = findPackageJson(jsYamlEntry);
const jsYamlPackage = JSON.parse(fs.readFileSync(jsYamlPackagePath, 'utf8'));

console.log(`electron-updater resolves js-yaml from: ${jsYamlEntry}`);
console.log(`electron-updater resolved js-yaml version: ${jsYamlPackage.version}`);

check(jsYamlPackage.version === '5.2.3', 'electron-updater actually resolves js-yaml 5.2.3');

const yaml = updaterRequire('js-yaml');

check(
  typeof yaml.load === 'function',
  'js-yaml 5.2.3 exposes the named/CommonJS load API electron-updater needs'
);

const sample = [
  'version: 1.3.2',
  'files:',
  '  - url: Download-video-Tubmedia-Setup-1.3.2-x64.exe',
  '    sha512: "AbCdEf123+/="',
  '    size: 303941353',
  'path: Download-video-Tubmedia-Setup-1.3.2-x64.exe',
  'sha512: "AbCdEf123+/="',
  'releaseDate: "2026-08-18T07:00:00.000Z"',
  ''
].join('\n');

const parsed = yaml.load(sample);

check(
  parsed &&
    parsed.version === '1.3.2' &&
    Array.isArray(parsed.files) &&
    parsed.files[0]?.url === 'Download-video-Tubmedia-Setup-1.3.2-x64.exe' &&
    parsed.files[0]?.size === 303941353,
  'js-yaml 5.2.3 parses Tubmedia latest.yml-shaped metadata correctly'
);

const updaterAppSourceCandidates = [
  path.join(cwd, 'node_modules', 'electron-updater', 'out', 'AppUpdater.js'),
  path.join(cwd, 'node_modules', 'electron-updater', 'out', 'AppUpdater.cjs')
];

const updaterAppSourcePath = updaterAppSourceCandidates.find((file) => fs.existsSync(file));

check(Boolean(updaterAppSourcePath), 'installed electron-updater AppUpdater implementation exists');

if (updaterAppSourcePath) {
  const updaterSource = fs.readFileSync(updaterAppSourcePath, 'utf8');

  check(
    /js-yaml/.test(updaterSource) && /\bload\b/.test(updaterSource),
    'installed electron-updater continues to use js-yaml load for YAML metadata'
  );
}

const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'));

const productionJsYamlEntries = Object.entries(lock.packages ?? {}).filter(
  ([packagePath, meta]) =>
    /(?:^|\/)node_modules\/js-yaml$/.test(packagePath.replaceAll('\\', '/')) &&
    meta &&
    meta.dev !== true &&
    meta.optional !== true
);

console.log(
  'production js-yaml package-lock entries:',
  productionJsYamlEntries.map(([packagePath, meta]) => ({
    packagePath,
    version: meta.version
  }))
);

check(
  productionJsYamlEntries.length >= 1 &&
    productionJsYamlEntries.every(([, meta]) => meta.version === '5.2.3'),
  'every production js-yaml package-lock entry resolves to 5.2.3'
);

const checkScript = pkg.scripts?.check ?? '';

check(
  pkg.scripts?.['verify:js-yaml-security'] === 'node scripts/verify-js-yaml-security-pre132.mjs',
  'js-yaml security verifier is registered'
);

check(
  typeof checkScript === 'string' && checkScript.includes('npm run verify:js-yaml-security'),
  'js-yaml security verification is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`js-yaml updater compatibility verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia js-yaml/updater compatibility verification OK: ${checks} checks.`);
