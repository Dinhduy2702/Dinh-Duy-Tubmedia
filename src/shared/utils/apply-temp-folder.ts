/**
 * Phần C rà soát giao diện (người dùng duyệt 2026-10-06): "Áp dụng thư mục tạm này cho tất cả danh sách".
 * CHỈ cho Thư mục tạm (thư mục lưu video/thành phẩm cần riêng theo từng danh sách); phạm vi theo từng trang — nơi gọi chỉ
 * truyền các danh sách của chính trang đó. Danh sách đang chạy/tạm dừng (ô bị khóa) được bỏ qua và nêu rõ lý do.
 */
export interface TempFolderLane {
  slot: string;
  name: string;
  tempFolder: string;
  /** Đang chạy hoặc tạm dừng — ô thư mục bị khóa, không được đổi. */
  locked: boolean;
}

export interface ApplyTempFolderPlan {
  changes: Array<{ slot: string; name: string; from: string }>;
  skipped: Array<{ slot: string; name: string }>;
  unchanged: Array<{ slot: string; name: string }>;
  /** Một dòng cho mỗi danh sách khác, để liệt kê trong hộp xác nhận. */
  details: string[];
}

function sameFolder(left: string, right: string): boolean {
  const normalize = (value: string): string => value.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

export function planApplyTempFolderToAll(
  lanes: readonly TempFolderLane[],
  sourceSlot: string,
  folder: string
): ApplyTempFolderPlan {
  const plan: ApplyTempFolderPlan = { changes: [], skipped: [], unchanged: [], details: [] };
  for (const lane of lanes) {
    if (lane.slot === sourceSlot) continue;
    if (sameFolder(lane.tempFolder, folder)) {
      plan.unchanged.push({ slot: lane.slot, name: lane.name });
      plan.details.push(`${lane.name}: đã dùng thư mục này`);
    } else if (lane.locked) {
      plan.skipped.push({ slot: lane.slot, name: lane.name });
      plan.details.push(`${lane.name}: bỏ qua — đang chạy hoặc tạm dừng`);
    } else {
      plan.changes.push({ slot: lane.slot, name: lane.name, from: lane.tempFolder });
      plan.details.push(`${lane.name}: ${lane.tempFolder.trim() || '(trống)'} → ${folder}`);
    }
  }
  return plan;
}
