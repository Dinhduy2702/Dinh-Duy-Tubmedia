import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const rootArgument = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : null;
const root = resolve(rootArgument || process.cwd());
const posix = (value) => value.split(sep).join('/');
const excludedFiles = new Set([
  'SOURCE_INVENTORY.sha256',
  'PROJECT_FILE_LIST.txt',
  'installer/generated-config.nsh'
]);
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'out',
  'release',
  'coverage',
  'test-results',
  'verification',
  'verification-logs',
  'playwright-report',
  '.cache',
  '.vite',
  '.tubmedia-patches'
]);
const allowedToolSourceFiles = new Set(['tool/.vdmsp-tool-metadata.json', 'tool/README_TOOL_VI.txt']);

function isManagedSourcePath(relativePath) {
  const normalized = relativePath.split('\\').join('/');
  const lower = normalized.toLowerCase();

  if (excludedFiles.has(normalized)) return false;
  if (lower.endsWith('.tsbuildinfo')) return false;
  if (lower.startsWith('tool/')) {
    return allowedToolSourceFiles.has(normalized);
  }
  return true;
}

async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = (await walk(root))
  .filter((file) => isManagedSourcePath(posix(relative(root, file))))
  .sort((left, right) => posix(relative(root, left)).localeCompare(posix(relative(root, right))));

const list = files.map((file) => posix(relative(root, file)));
await writeFile(join(root, 'PROJECT_FILE_LIST.txt'), `${list.join('\n')}\n`, 'utf8');

const checksumLines = [];
for (const file of files) {
  const digest = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
    .toUpperCase();
  checksumLines.push(`${digest}  ${posix(relative(root, file))}`);
}
await writeFile(join(root, 'SOURCE_INVENTORY.sha256'), `${checksumLines.join('\n')}\n`, 'utf8');
console.log(`Generated source inventory: ${files.length} files.`);
