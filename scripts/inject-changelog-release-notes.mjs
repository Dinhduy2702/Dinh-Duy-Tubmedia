#!/usr/bin/env node
/**
 * Giai đoạn 5 (2026-09-24) — dùng cho pipeline `release:windows` (build-release-windows.ps1): tệp
 * latest.yml/beta.yml ở đây do electron-builder TỰ TẠO (không qua write-updater-metadata-utf8nobom.mjs),
 * nên cần một bước RIÊNG đọc lại, chèn thêm trường releaseNotes lấy thật từ CHANGELOG.md, rồi ghi đè —
 * giữ nguyên mọi trường khác electron-builder đã tạo (files, sha512, path, releaseDate...).
 *
 * Cách dùng: node scripts/inject-changelog-release-notes.mjs --file <đường dẫn .yml> --version <version>
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChangelogSection } from './changelog-section.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') out.file = argv[++i];
    else if (argv[i] === '--version') out.version = argv[++i];
    else if (argv[i] === '--changelog') out.changelog = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');

const args = parseArgs(process.argv.slice(2));
if (!args.file) throw new Error('Missing required --file <path to .yml>');
if (!args.version) throw new Error('Missing required --version <version>');

const changelogPath = args.changelog ?? join(projectRoot, 'CHANGELOG.md');
const releaseNotes = readChangelogSection(args.version, changelogPath);

if (releaseNotes === null) {
  throw new Error(
    `CHANGELOG.md thiếu mục "# Tubmedia ${args.version}" — không thể chèn ghi chú phát hành vào ${args.file}.`
  );
}
if (!releaseNotes) {
  throw new Error(`Mục "# Tubmedia ${args.version}" trong CHANGELOG.md đang trống.`);
}

// Dùng đúng bản js-yaml mà electron-updater thật sự phân giải khi đọc lại tệp này lúc chạy — nhất quán
// với write-updater-metadata-utf8nobom.mjs.
const updaterPackagePath = join(projectRoot, 'node_modules', 'electron-updater', 'package.json');
const updaterRequire = createRequire(updaterPackagePath);
const yaml = updaterRequire('js-yaml');

const filePath = resolve(args.file);
const original = readFileSync(filePath, 'utf8');
const parsed = yaml.load(original);

if (!parsed || typeof parsed !== 'object') {
  throw new Error(`${filePath} không phải một tệp YAML hợp lệ.`);
}

parsed.releaseNotes = releaseNotes;

// js-yaml.dump giữ nguyên thứ tự khóa đã có (không sắp lại theo alphabet trừ khi yêu cầu) — 'version'
// vẫn ở đầu như electron-builder đã tạo.
const updated = yaml.dump(parsed, { lineWidth: -1, noRefs: true });

// electron-updater đọc tệp này qua js-yaml — chỉ cần UTF-8 không BOM (fs.writeFileSync với 'utf8' không
// bao giờ tự thêm BOM), không cần khớp byte-for-byte với định dạng electron-builder tự tạo ban đầu.
writeFileSync(filePath, updated, { encoding: 'utf8' });

const reparsed = yaml.load(readFileSync(filePath, 'utf8'));
if (reparsed?.releaseNotes?.trim() !== releaseNotes.trim() || reparsed?.version !== parsed.version) {
  throw new Error(`${filePath} không khớp lại đúng sau khi ghi đè — hủy để không phát hành metadata sai.`);
}

console.log(`RELEASE_NOTES_INJECTED_OK file=${filePath} version=${parsed.version} lines=${releaseNotes.split('\n').length}`);
