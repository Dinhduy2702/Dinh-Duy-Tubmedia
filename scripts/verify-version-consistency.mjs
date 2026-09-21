// Kiểm tra số phiên bản đồng nhất ở mọi nơi và không kiểm tra tự động nào cứng số phiên bản.
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { VERSION_FILES, collectVersionProblems, findHardcodedVersionChecks } from './version-tools.mjs';

const root = resolve(process.cwd());
const files = {};
for (const path of Object.values(VERSION_FILES)) {
  try {
    files[path] = await readFile(join(root, path), 'utf8');
  } catch {
    files[path] = undefined;
  }
}
const present = Object.fromEntries(Object.entries(files).filter(([, text]) => typeof text === 'string'));
const problems = collectVersionProblems(present);

const scanTargets = [];
for (const name of await readdir(join(root, 'scripts'))) {
  if (/^verify-.*\.mjs$/.test(name) && name !== 'verify-version-consistency.mjs') {
    scanTargets.push(`scripts/${name}`);
  }
}
for (const name of await readdir(join(root, 'tests/unit'))) {
  // Test của chính công cụ phiên bản cần chuỗi mẫu; các test khác không được cứng số phiên bản.
  if (name.endsWith('.test.ts') && name !== 'version-tools.test.ts') scanTargets.push(`tests/unit/${name}`);
}
for (const path of scanTargets) {
  problems.push(...findHardcodedVersionChecks(path, await readFile(join(root, path), 'utf8')));
}

if (problems.length > 0) {
  console.error('Kiểm tra số phiên bản THẤT BẠI:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
const version = JSON.parse(files[VERSION_FILES.packageJson]).version;
console.log(`Số phiên bản đồng nhất ${version}: ${Object.keys(present).length} tệp gốc + ${scanTargets.length} tệp kiểm tra được quét.`);
