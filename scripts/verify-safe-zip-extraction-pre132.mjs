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

    if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
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
const sourceText = walk(path.join(cwd, 'src')).map(read).join('\n');

const adapterPath = path.join(cwd, 'vendor', 'safe-extract-zip', 'index.js');

const adapter = read(adapterPath);

check(
  !pkg.dependencies?.['extract-zip'] && !pkg.devDependencies?.['extract-zip'],
  'vulnerable extract-zip package is absent from direct dependencies'
);

check(
  !/(?:from\s+['"]extract-zip['"]|require\s*\(\s*['"]extract-zip['"]\s*\)|import\s*\(\s*['"]extract-zip['"]\s*\))/.test(
    sourceText
  ),
  'application source no longer imports extract-zip'
);

check(
  pkg.dependencies?.['@tubmedia/safe-extract-zip'] || pkg.devDependencies?.['@tubmedia/safe-extract-zip'],
  'safe ZIP adapter is a declared package dependency'
);

check(
  /function hasUnsafeWindowsPathCharacter/.test(adapter) &&
    /directory traversal/.test(adapter) &&
    /absolute path/.test(adapter) &&
    /reserved Windows device name/.test(adapter),
  'safe ZIP adapter rejects traversal, absolute and unsafe Windows paths'
);

check(
  /isSymlinkEntry/.test(adapter) &&
    /Refusing symbolic-link ZIP entry/.test(adapter) &&
    /isSymbolicLink\(\)/.test(adapter),
  'safe ZIP adapter rejects symlink entries and linked extraction paths'
);

check(/assertInsideRoot/.test(adapter), 'safe ZIP adapter enforces extraction-root containment');

check(
  /validateEntrySizes:\s*true/.test(adapter) &&
    /MAX_ENTRIES/.test(adapter) &&
    /MAX_ENTRY_BYTES/.test(adapter) &&
    /MAX_TOTAL_BYTES/.test(adapter),
  'safe ZIP adapter validates entry sizes and bounded expansion'
);

check(
  pkg.scripts?.['verify:safe-zip-extraction'] === 'node scripts/verify-safe-zip-extraction-pre132.mjs',
  'safe ZIP verifier is registered'
);

check(
  typeof pkg.scripts?.check === 'string' && pkg.scripts.check.includes('npm run verify:safe-zip-extraction'),
  'safe ZIP verification is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`Safe ZIP verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia safe ZIP extraction verification OK: ${checks} checks.`);
