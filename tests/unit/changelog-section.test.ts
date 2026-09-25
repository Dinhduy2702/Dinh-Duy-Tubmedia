/**
 * Giai đoạn 5 (2026-09-24) — "Luồng cập nhật + hướng dẫn phát hành": extractChangelogSection() trích
 * đúng mục CHANGELOG.md của một phiên bản để dùng làm ghi chú phát hành tiếng Việt — dùng chung cho
 * write-updater-metadata-utf8nobom.mjs (latest.yml) và workflow GitHub Actions phát hành chính thức
 * (trước đây hai nơi này chép tay riêng, không đồng bộ với CHANGELOG.md thật).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractChangelogSection, readChangelogSection } from '../../scripts/changelog-section.mjs';

const SAMPLE_CHANGELOG = [
  '# Tubmedia 1.3.7',
  '',
  '- Sửa lỗi A.',
  '- Sửa lỗi B.',
  '',
  '# Tubmedia 1.3.6',
  '',
  '- Việc cũ hơn, không được lẫn vào mục 1.3.7.',
  ''
].join('\n');

describe('Giai đoạn 5 — extractChangelogSection (nguồn ghi chú phát hành thật, không chép tay)', () => {
  it('trích đúng các dòng gạch đầu dòng của đúng phiên bản, dừng trước tiêu đề phiên bản kế tiếp', () => {
    expect(extractChangelogSection(SAMPLE_CHANGELOG, '1.3.7')).toBe('- Sửa lỗi A.\n- Sửa lỗi B.');
  });

  it('không lẫn nội dung của phiên bản khác vào', () => {
    const section = extractChangelogSection(SAMPLE_CHANGELOG, '1.3.7');
    expect(section).not.toContain('Việc cũ hơn');
  });

  it('phiên bản đúng thứ tự thứ hai trong tệp vẫn trích đúng, dừng ở cuối tệp', () => {
    expect(extractChangelogSection(SAMPLE_CHANGELOG, '1.3.6')).toBe(
      '- Việc cũ hơn, không được lẫn vào mục 1.3.7.'
    );
  });

  it('không tìm thấy phiên bản: trả về null, KHÔNG bịa nội dung', () => {
    expect(extractChangelogSection(SAMPLE_CHANGELOG, '9.9.9')).toBeNull();
  });

  it('bỏ dòng trống đầu/cuối mục nhưng giữ nguyên dòng trống ở giữa (nếu có)', () => {
    const withBlankInMiddle = [
      '# Tubmedia 2.0.0',
      '',
      '',
      '- Dòng một.',
      '',
      '- Dòng hai.',
      '',
      ''
    ].join('\n');
    expect(extractChangelogSection(withBlankInMiddle, '2.0.0')).toBe('- Dòng một.\n\n- Dòng hai.');
  });

  it('mục rỗng (chỉ có tiêu đề, không có nội dung) trả về chuỗi rỗng, không phải null', () => {
    const emptySection = ['# Tubmedia 3.0.0', '', '# Tubmedia 2.0.0', '- cũ'].join('\n');
    expect(extractChangelogSection(emptySection, '3.0.0')).toBe('');
  });

  it("readChangelogSection đọc đúng CHANGELOG.md THẬT của repo cho phiên bản hiện tại (1.3.7)", () => {
    // Xác nhận thật bằng tệp CHANGELOG.md thật của dự án, không phải mẫu giả — đúng tinh thần xác minh
    // thật đã áp dụng xuyên suốt dự án.
    const realChangelog = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const expected = extractChangelogSection(realChangelog, '1.3.7');
    expect(readChangelogSection('1.3.7')).toBe(expected);
    expect(expected).toContain('FPS');
  });

  it('phiên bản không tồn tại trong CHANGELOG.md thật: trả về null (không ném lỗi ở đây — CLI mới là nơi báo lỗi)', () => {
    expect(readChangelogSection('9.9.9-khong-ton-tai')).toBeNull();
  });
});
