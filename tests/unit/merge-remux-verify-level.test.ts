import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tệp vừa remux được giải mã toàn bộ (deep) trừ khi nguồn VỪA được giải mã toàn bộ. Trong MergeEngine chỉ nhánh "concat
 * trực tiếp chưa phù hợp" (không cần chuẩn hóa → mọi nguồn là stream-copy, đã qua "kiểm tra toàn bộ nguồn") được bỏ qua;
 * nhánh chuẩn hóa timestamp (tệp remux thay chỗ nguồn, nguồn không được kiểm) và nhánh sửa timestamp phải kiểm deep.
 */
describe('MergeEngine: mức kiểm tệp vừa remux', () => {
  it('chỉ nhánh remux sau khi mọi nguồn đã giải mã toàn bộ mới được bỏ kiểm deep', async () => {
    const merge = await readFile(join(process.cwd(), 'src/main/merge/merge-engine.ts'), 'utf8');
    const calls = merge.split('this.normalizer.remuxForConcat(').slice(1).map((rest) => {
      let depth = 1;
      for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] === '(') depth += 1;
        else if (rest[index] === ')' && --depth === 0) return rest.slice(0, index);
      }
      return rest;
    });

    expect(calls).toHaveLength(3);
    const skipping = calls.filter((call) => call.includes('sourceDecodeVerified: true'));
    expect(skipping).toHaveLength(1);
    expect(skipping[0]).toContain('Remux video ${index + 1}');
    expect(merge.indexOf('Concat trực tiếp chưa phù hợp')).toBeGreaterThan(0);
    expect(merge.indexOf('sourceDecodeVerified: true')).toBeGreaterThan(merge.indexOf('Concat trực tiếp chưa phù hợp'));
    expect(merge.indexOf('sourceDecodeVerified: true')).toBeGreaterThan(merge.indexOf("verify(item.path, 'deep'"));
  });
});
