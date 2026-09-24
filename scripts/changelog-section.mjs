#!/usr/bin/env node
/**
 * Giai đoạn 5 (2026-09-24) — "Luồng cập nhật + hướng dẫn phát hành": trích đúng mục CHANGELOG.md của một
 * phiên bản, dùng chung cho MỌI nơi cần ghi chú phát hành tiếng Việt — cả script viết latest.yml
 * (scripts/write-updater-metadata-utf8nobom.mjs) lẫn workflow GitHub Actions phát hành chính thức
 * (.github/workflows/publish-tubmedia-release.yml, gọi qua CLI bên dưới). Trước đây nội dung này bị gõ
 * tay riêng trong workflow, tách rời khỏi CHANGELOG.md thật — đúng kiểu "hai nơi lưu một sự thật" rủi ro
 * đã tìm thấy trong đợt rà soát toàn diện.
 *
 * Định dạng CHANGELOG.md: mỗi phiên bản bắt đầu bằng dòng `# Tubmedia <version>`, nội dung là các dòng
 * gạch đầu dòng cho tới dòng `# Tubmedia` kế tiếp hoặc hết tệp.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Trích đúng đoạn nội dung của MỘT phiên bản từ toàn bộ text CHANGELOG.md. Trả về null nếu không thấy
 * dòng tiêu đề `# Tubmedia <version>` — không bịa nội dung, không trả về đoạn của phiên bản khác. */
export function extractChangelogSection(changelogText, version) {
  const heading = `# Tubmedia ${version}`;
  const lines = changelogText.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) return null;

  const bodyLines = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^# Tubmedia\s/.test(line)) break;
    bodyLines.push(line);
  }

  while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift();
  while (bodyLines.length > 0 && bodyLines.at(-1).trim() === '') bodyLines.pop();

  return bodyLines.join('\n');
}

/** Đọc CHANGELOG.md thật (mặc định ở thư mục gốc dự án) và trích đúng mục của `version`. */
export function readChangelogSection(version, changelogPath = join(process.cwd(), 'CHANGELOG.md')) {
  const text = readFileSync(changelogPath, 'utf8');
  return extractChangelogSection(text, version);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const version = process.argv[2];
  if (!version) {
    console.error('Cách dùng: node scripts/changelog-section.mjs <version>');
    process.exit(1);
  }
  const section = readChangelogSection(version);
  if (section === null) {
    console.error(`Không tìm thấy mục "# Tubmedia ${version}" trong CHANGELOG.md.`);
    process.exit(1);
  }
  if (!section) {
    console.error(`Mục "# Tubmedia ${version}" trong CHANGELOG.md đang trống.`);
    process.exit(1);
  }
  process.stdout.write(section + '\n');
}
