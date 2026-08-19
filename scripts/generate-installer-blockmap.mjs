import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = String(pkg.version);
const installer = path.join(root, 'release', `Download-video-Tubmedia-Setup-${version}-x64.exe`);
const blockmap = `${installer}.blockmap`;

function findAppBuilder() {
  const directCandidates = [
    path.join(root, 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe'),
    path.join(root, 'node_modules', 'app-builder-bin', 'win', 'ia32', 'app-builder.exe')
  ];

  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    const packageJson = require.resolve('app-builder-bin/package.json');
    const packageRoot = path.dirname(packageJson);
    const candidates = [
      path.join(packageRoot, 'win', 'x64', 'app-builder.exe'),
      path.join(packageRoot, 'win', 'ia32', 'app-builder.exe')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // handled by the final fail-closed error below
  }

  throw new Error('app-builder blockmap helper missing; run npm install before release build');
}

const appBuilder = findAppBuilder();

if (!fs.existsSync(installer)) {
  throw new Error(`installer missing: ${installer}`);
}

const result = spawnSync(appBuilder, ['blockmap', '--input', installer, '--output', blockmap], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  throw new Error(`blockmap failed: ${result.status}`);
}

const parsed = JSON.parse(gunzipSync(fs.readFileSync(blockmap)).toString('utf8'));

let chunks = 0;
for (const file of parsed.files || []) {
  chunks += Array.isArray(file.checksums) ? file.checksums.length : 0;
}

if (!Array.isArray(parsed.files) || !parsed.files.length || chunks < 1) {
  throw new Error('invalid blockmap');
}

console.log(`BLOCKMAP_GENERATED file=${blockmap} files=${parsed.files.length} chunks=${chunks}`);
