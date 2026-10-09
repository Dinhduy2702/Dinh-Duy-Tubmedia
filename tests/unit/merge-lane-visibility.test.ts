import { describe, expect, it } from 'vitest';
import { hiddenLanesNote, hiddenLanesWithData, laneFormWhenShown } from '../../src/shared/utils/merge-lane-visibility.js';

// Đợt 5 mục 16 (rà soát bản cài 1.5.0): Ghép theo Timeline hiện "1/6 quy trình" mà quy trình "Duy_12_09_2026" (đã lưu, còn
// dữ liệu) bị ẩn không một lời nhắc; hiện lại thì ô thư mục bị thư mục nhớ gần nhất đè lên thư mục đã lưu của nó.

const lanes = [
  { slot: 'merge-1', name: 'Ghep_mot', hasData: true },
  { slot: 'merge-2', name: 'Duy_12_09_2026', hasData: true },
  { slot: 'merge-3', name: 'Quy trình 3', hasData: false },
  { slot: 'merge-4', name: 'Ghep_bon', hasData: true }
];

describe('hiddenLanesWithData', () => {
  it('chỉ lấy quy trình nằm ngoài số đang hiện mà còn dữ liệu', () => {
    expect(hiddenLanesWithData(lanes, 1).map((lane) => lane.name)).toEqual(['Duy_12_09_2026', 'Ghep_bon']);
    expect(hiddenLanesWithData(lanes, 3).map((lane) => lane.name)).toEqual(['Ghep_bon']);
    expect(hiddenLanesWithData(lanes, 4)).toEqual([]);
  });
});

describe('hiddenLanesNote', () => {
  it('nêu tên quy trình đang ẩn, nói rõ dữ liệu vẫn giữ và cách hiện lại', () => {
    const note = hiddenLanesNote(['Duy_12_09_2026']);
    expect(note).toContain('Duy_12_09_2026');
    expect(note).toContain('Thêm quy trình');
    expect(note).toMatch(/giữ nguyên/);
  });

  it('nhiều quy trình: đếm đúng và nêu đủ tên', () => {
    const note = hiddenLanesNote(['Duy_12_09_2026', 'Ghep_bon']);
    expect(note).toContain('2 quy trình');
    expect(note).toContain('Duy_12_09_2026');
    expect(note).toContain('Ghep_bon');
  });

  it('không có quy trình ẩn nào còn dữ liệu: không có ghi chú', () => {
    expect(hiddenLanesNote([])).toBeNull();
  });
});

describe('laneFormWhenShown', () => {
  const current = { sourceFolder: 'D:/nguon-2', tempFolder: 'D:/tam-2', outputFolder: 'D:/xuat-2', name: 'Duy_12_09_2026' };
  const remembered = { sourceFolder: 'D:/nguon-1', tempFolder: 'D:/tam-1', outputFolder: 'D:/xuat-1' };

  it('quy trình đã lưu: giữ nguyên thư mục của nó', () => {
    expect(laneFormWhenShown(current, remembered, true)).toEqual(current);
  });

  it('quy trình trống: điền thư mục nhớ gần nhất như trước', () => {
    expect(laneFormWhenShown(current, remembered, false)).toEqual({ ...current, ...remembered });
  });
});
