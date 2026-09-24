import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

const cwd = process.cwd();

function hasUtf8Bom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function firstBytesHex(bytes, count = 12) {
  return [...bytes.subarray(0, Math.min(count, bytes.length))]
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
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

const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));

const writerPath = path.join(cwd, 'scripts', 'write-updater-metadata-utf8nobom.mjs');

const writer = fs.readFileSync(writerPath, 'utf8');

check(
  /fs\.writeFileSync\(latestPath, text, \{ encoding: 'utf8' \}\)/.test(writer),
  'updater metadata is written by Node as UTF-8'
);

// Giai đoạn 5 (2026-09-24): ghi chú phát hành PHẢI lấy thật từ CHANGELOG.md — không được để trống hoặc
// chép tay lặp lại một nơi khác (đúng vấn đề đã tìm thấy ở workflow GitHub Actions phát hành).
check(
  /import\s*\{\s*readChangelogSection\s*\}\s*from\s*'\.\/changelog-section\.mjs'/.test(writer),
  'updater metadata writer sources release notes from CHANGELOG.md'
);
check(
  /throw new Error/.test(writer) && /releaseNotes === null/.test(writer),
  'updater metadata writer fails loudly when the version is missing from CHANGELOG.md'
);
check(
  /releaseNotes: \|/.test(writer),
  'updater metadata writer emits releaseNotes as a literal YAML block scalar'
);

check(
  /hasUtf8Bom/.test(writer) && /Buffer\.from\('version:', 'ascii'\)/.test(writer),
  'writer verifies BOM bytes and exact ASCII version prefix'
);

check(
  typeof pkg.scripts?.['dist:nsis-safe'] === 'string' &&
    pkg.scripts['dist:nsis-safe'].includes('scripts/build-installer-windows.ps1') &&
    pkg.scripts['dist:nsis-safe'].includes('node scripts/write-updater-metadata-utf8nobom.mjs'),
  'dist:nsis-safe chains NSIS build then the Node metadata writer'
);

const updaterPackagePath = path.join(cwd, 'node_modules', 'electron-updater', 'package.json');

const updaterRequire = createRequire(updaterPackagePath);
const yaml = updaterRequire('js-yaml');

check(typeof yaml.load === 'function', 'electron-updater resolved js-yaml exposes load()');

const sample = [
  'version: 1.3.2',
  'files:',
  '  - url: "Download-video-Tubmedia-Setup-1.3.2-x64.exe"',
  '    sha512: AbCdEf123+/=',
  '    size: 304098822',
  'path: "Download-video-Tubmedia-Setup-1.3.2-x64.exe"',
  'sha512: AbCdEf123+/=',
  "releaseDate: '2026-08-18T08:00:00.000Z'",
  'releaseNotes: |',
  '  - Ghi chú phát hành thật: dấu hai chấm (như: đây) và tiếng Việt phải còn nguyên vẹn.',
  ''
].join('\n');

const sampleParsed = yaml.load(sample);

check(
  sampleParsed?.version === '1.3.2' && sampleParsed?.files?.[0]?.size === 304098822,
  'electron-updater js-yaml parses canonical updater metadata'
);
check(
  sampleParsed?.releaseNotes?.trim() ===
    '- Ghi chú phát hành thật: dấu hai chấm (như: đây) và tiếng Việt phải còn nguyên vẹn.',
  'electron-updater js-yaml parses Vietnamese literal block release notes intact'
);

const latestPath = path.join(cwd, 'release', 'latest.yml');

if (fs.existsSync(latestPath)) {
  const bytes = fs.readFileSync(latestPath);
  const expectedPrefix = Buffer.from('version:', 'ascii');

  console.log(`release/latest.yml first bytes: ${firstBytesHex(bytes)}`);

  check(!hasUtf8Bom(bytes), 'release/latest.yml has no UTF-8 BOM bytes');

  check(
    bytes.subarray(0, expectedPrefix.length).equals(expectedPrefix),
    'release/latest.yml begins with ASCII version:'
  );

  let decoded = '';
  let parsed;

  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    check(true, 'release/latest.yml is strict UTF-8');
  } catch (error) {
    console.error(error);
    check(false, 'release/latest.yml is strict UTF-8');
  }

  try {
    parsed = yaml.load(decoded);
    check(true, 'release/latest.yml parses with electron-updater js-yaml');
  } catch (error) {
    console.error(error);
    check(false, 'release/latest.yml parses with electron-updater js-yaml');
  }

  check(
    parsed?.version === pkg.version && Array.isArray(parsed?.files) && parsed.files.length > 0,
    'release/latest.yml matches package version and file schema'
  );
  check(
    typeof parsed?.releaseNotes === 'string' && parsed.releaseNotes.trim().length > 0,
    'release/latest.yml carries real Vietnamese release notes from CHANGELOG.md'
  );
}

check(
  pkg.scripts?.['verify:updater-metadata'] === 'node scripts/verify-updater-metadata-encoding-pre132.mjs',
  'updater metadata verifier is registered'
);

check(
  typeof pkg.scripts?.check === 'string' && pkg.scripts.check.includes('npm run verify:updater-metadata'),
  'updater metadata verification is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`Updater metadata verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia updater metadata verification OK: ${checks} checks.`);
