/**
 * Đợt 5 mục 16 (rà soát bản cài 1.5.0): "Bớt quy trình" ở Ghép theo Timeline chỉ ẩn quy trình — dữ liệu (danh sách liên kết,
 * hàng đợi, nhật ký) vẫn còn và vẫn hiện ở trang Ghép & Xuất. Trước đây ẩn không một lời nhắc, và khi hiện lại thì thư mục
 * đã lưu của quy trình bị thư mục nhớ gần nhất đè lên.
 */

export interface LaneVisibilityEntry {
  slot: string;
  name: string;
  /** Quy trình đã lưu (có dự án trong CSDL). */
  hasData: boolean;
}

/** Quy trình nằm ngoài số đang hiện mà vẫn còn dữ liệu. */
export function hiddenLanesWithData<T extends LaneVisibilityEntry>(lanes: readonly T[], visibleCount: number): T[] {
  return lanes.slice(visibleCount).filter((lane) => lane.hasData);
}

export function hiddenLanesNote(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const subject = names.length === 1 ? `quy trình "${names[0]}"` : `${names.length} quy trình: ${names.map((name) => `"${name}"`).join(', ')}`;
  return `Đang ẩn ${subject} — dữ liệu vẫn giữ nguyên. Bấm "Thêm quy trình" để hiện lại.`;
}

/**
 * Form của quy trình vừa được hiện thêm: quy trình đã lưu giữ nguyên form của nó (thư mục, chất lượng, tỉ lệ…); quy trình
 * trống mới điền các giá trị nhớ gần nhất (như trước).
 */
export function laneFormWhenShown<T extends object>(current: T, fill: Partial<T>, hasData: boolean): T {
  return hasData ? current : { ...current, ...fill };
}
