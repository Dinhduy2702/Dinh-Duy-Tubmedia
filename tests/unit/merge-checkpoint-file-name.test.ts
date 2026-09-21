import { describe, expect, it } from 'vitest';
import { MAX_CHECKPOINT_STEM_LENGTH, checkpointFileStem } from '../../src/main/merge/merge-engine.js';
import { sanitizeFilename } from '../../src/shared/utils/filename.js';

const SIGNATURE = 'a'.repeat(24); // createMergeCheckpointSignature trả về 24 ký tự hex
const NTFS_COMPONENT_LIMIT = 255;

describe('Tên tệp checkpoint của Tải & Ghép không vượt giới hạn 255 ký tự của NTFS', () => {
  it('mọi độ dài tên thành phẩm cho phép (1–220) cho tên checkpoint và biên nhận ≤ 255', () => {
    for (let length = 1; length <= 220; length += 1) {
      const stem = checkpointFileStem(sanitizeFilename('N'.repeat(length)));
      expect(`${stem}.${SIGNATURE}.pending.mp4`.length).toBeLessThanOrEqual(NTFS_COMPONENT_LIMIT);
      expect(`${stem}.${SIGNATURE}.complete.json`.length).toBeLessThanOrEqual(NTFS_COMPONENT_LIMIT);
    }
  });

  it('tên ngắn giữ nguyên để checkpoint cũ vẫn được tìm thấy', () => {
    expect(checkpointFileStem('Ghép tương thích — tiếng Việt')).toBe('Ghép tương thích — tiếng Việt');
    const boundary = 'x'.repeat(MAX_CHECKPOINT_STEM_LENGTH);
    expect(checkpointFileStem(boundary)).toBe(boundary);
  });

  it('cùng một tên luôn cho cùng một phần tên (checkpoint tìm lại được sau khi mở lại app)', () => {
    const name = sanitizeFilename('Tên rất dài '.repeat(20));
    expect(checkpointFileStem(name)).toBe(checkpointFileStem(name));
  });

  it('không cắt đôi ký tự emoji và không để lại dấu chấm/khoảng trắng ở cuối', () => {
    const emoji = '🎬'.repeat(110); // mỗi emoji = 2 đơn vị UTF-16
    const stem = checkpointFileStem(emoji);
    const last = stem.charCodeAt(stem.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(stem.length).toBeLessThanOrEqual(MAX_CHECKPOINT_STEM_LENGTH);

    const padded = `${'a'.repeat(MAX_CHECKPOINT_STEM_LENGTH - 3)}...${'b'.repeat(30)}`;
    expect(checkpointFileStem(padded)).toMatch(/[^. ]$/);
  });

  it('không bao giờ trả về chuỗi rỗng', () => {
    expect(checkpointFileStem('.'.repeat(200))).toBe('Thành phẩm');
  });
});
