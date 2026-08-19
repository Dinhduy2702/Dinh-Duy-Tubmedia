import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const prepare = String(pkg.scripts?.['prepare:aria2'] || '');
const dist = String(pkg.scripts?.['dist:nsis-safe'] || '');
const checkScript = String(pkg.scripts?.check || '');
const ensure = fs.readFileSync('scripts/ensure-bundled-aria2.ps1', 'utf8');

let checks = 0;
let failures = 0;

function check(ok, label) {
  checks += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

check(pkg.version === '1.3.3', 'package version is 1.3.3');
check(prepare.includes('ensure-bundled-aria2.ps1'), 'prepare:aria2 owns the bundled aria2 bootstrap');
check(dist.includes('npm run prepare:aria2'), 'official NSIS build prepares aria2 before packaging');
check(
  dist.indexOf('npm run prepare:aria2') < dist.indexOf('build-installer-windows.ps1'),
  'aria2 preparation runs before installer packaging'
);
check(
  ensure.includes('tool') && ensure.includes('aria2c.exe'),
  'aria2 is copied to the project tool payload'
);
check(ensure.includes('aria2-1.37.0-win-64bit-build1.zip'), 'aria2 Windows x64 release is pinned');
check(
  ensure.includes('67D015301EEF0B612191212D564C5BB0A14B5B9C4796B76454276A4D28D9B288'),
  'aria2 archive SHA-256 is pinned'
);
check(
  ensure.includes('Get-FileHash') && ensure.includes('SHA256'),
  'aria2 archive is checksum verified before extraction'
);
check(
  checkScript.includes('npm run verify:bundled-aria2'),
  'bundled aria2 verifier is permanent in npm run check'
);
check(fs.existsSync('tool/aria2c.exe'), 'source build payload currently contains aria2c.exe');

if (failures) {
  throw new Error(`Bundled aria2 verifier failed ${failures}/${checks}`);
}

console.log(`Tubmedia bundled aria2 verification OK: ${checks} checks.`);
