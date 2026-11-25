/**
 * Khi dữ liệu workbench từ tiến trình chính nạp xong, giữ nguyên form của các làn
 * người dùng đã sửa (dirty) hoặc đã xóa trong lúc chờ nạp để không bị ghi đè ngược.
 */
export function mergeLoadedLaneForms<Slot extends string, Form>(
  slots: readonly Slot[],
  current: Record<Slot, Form>,
  loaded: Record<Slot, Form>,
  dirtySlots: ReadonlySet<Slot>,
  deletedSlots: ReadonlySet<Slot>
): Record<Slot, Form> {
  const merged = { ...loaded };
  for (const slot of slots) {
    if (dirtySlots.has(slot) || deletedSlots.has(slot)) {
      merged[slot] = current[slot];
    }
  }
  return merged;
}
