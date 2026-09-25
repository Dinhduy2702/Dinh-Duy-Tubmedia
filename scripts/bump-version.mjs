// Tăng số phiên bản ở MỌI nơi cần thiết bằng một lệnh:
//   npm run bump -- 1.4.0            (ghi thật)
//   npm run bump -- 1.4.0 --dry-run  (chỉ liệt kê, không ghi)
// Tùy chọn: --no-inventory (không tạo lại SOURCE_INVENTORY.sha256), --root <thư mục> (dùng cho kiểm thử).
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { CHANGELOG_STUB_MARKER, VERSION_FILES, collectVersionProblems, planVersionBump } from './version-tools.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? (args[rootIndex + 1] ?? '') : process.cwd());
const dryRun = args.includes('--dry-run');
const skipInventory = args.includes('--no-inventory');
const version = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--root');

function fail(message) {
  console.error(`LỖI: ${message}`);
  process.exit(1);
}

if (!version) {
  fail('Thiếu số phiên bản. Ví dụ: npm run bump -- 1.4.0');
}

const files = {};
for (const path of Object.values(VERSION_FILES)) {
  try {
    files[path] = await readFile(join(root, path), 'utf8');
  } catch {
    fail(`Không đọc được ${path} trong ${root}.`);
  }
}

let plan;
try {
  plan = planVersionBump(files, version);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

console.log(`Tăng phiên bản ${plan.from} → ${plan.to}${dryRun ? ' (chạy thử, không ghi)' : ''}:`);
for (const path of Object.keys(plan.files)) console.log(`  - ${path}`);

const merged = { ...files, ...plan.files };
const problems = collectVersionProblems(merged).filter((problem) => !problem.includes(CHANGELOG_STUB_MARKER));
if (problems.length > 0) {
  fail(`Sau khi tăng vẫn còn chỗ lệch, không ghi gì cả:\n  ${problems.join('\n  ')}`);
}

if (dryRun) process.exit(0);

for (const [path, text] of Object.entries(plan.files)) {
  await writeFile(join(root, path), text, 'utf8');
}

if (!skipInventory) {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const inventory = spawnSync(process.execPath, [join(scriptDirectory, 'generate-source-inventory.mjs'), '--root', root], {
    cwd: root,
    stdio: 'inherit'
  });
  if (inventory.status !== 0) fail('Không tạo lại được SOURCE_INVENTORY.sha256.');
}

if (plan.files[VERSION_FILES.changelog]?.includes(CHANGELOG_STUB_MARKER)) {
  console.log(`\nVIỆC CẦN LÀM TIẾP: mở CHANGELOG.md, thay dòng "${CHANGELOG_STUB_MARKER}" bằng ghi chú thật`);
  console.log('bằng tiếng Việt, rồi chạy: node scripts/generate-source-inventory.mjs');
}
console.log('Xong. Chạy npm.cmd run verify:version để kiểm tra lại.');
