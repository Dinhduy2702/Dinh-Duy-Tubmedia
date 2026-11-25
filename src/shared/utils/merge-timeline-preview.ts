import type { ParsedInputLine, QueueJob, TimelineRow } from '../types/domain.js';

type ItemKeySource = Pick<
  ParsedInputLine,
  'normalizedUrl' | 'url' | 'originalText' | 'timestampStartSeconds' | 'timestampEndSeconds' | 'audioMode' | 'note'
>;

/** Chữ ký ổn định cho 1 dòng video trong danh sách ghép để đối chiếu với lượt ghép gần nhất. */
export function mergeItemMatchKey(item: ItemKeySource): string {
  return JSON.stringify([
    item.normalizedUrl ?? item.url ?? item.originalText.trim(),
    item.timestampStartSeconds,
    item.timestampEndSeconds,
    item.audioMode,
    item.note
  ]);
}

/**
 * Chỉ bật timeline thực tế khi lượt ghép mới nhất đã tạo ra `timelineRows` VÀ danh sách link
 * hiện tại trên giao diện vẫn khớp chính xác với lượt ghép đó (chưa bị thêm/bớt/đổi thứ tự).
 */
export function doesTimelineMatchCurrentLinks(
  items: readonly ParsedInputLine[],
  mergeJob: QueueJob | undefined,
  downloadJobs: readonly QueueJob[],
  timelineRows: readonly TimelineRow[]
): boolean {
  if (!mergeJob || timelineRows.length === 0) return false;
  const storedKeys = mergeJob.input.mergedItemKeys;
  if (Array.isArray(storedKeys)) {
    return (
      storedKeys.length === items.length &&
      items.every((item, index) => storedKeys[index] === mergeItemMatchKey(item))
    );
  }
  if (items.length !== timelineRows.length) return false;
  const downloadUrls = new Set(
    downloadJobs
      .map((job) => (typeof job.input.url === 'string' ? job.input.url : null))
      .filter((url): url is string => Boolean(url))
  );
  if (
    downloadUrls.size > 0 &&
    items.some((item) => item.normalizedUrl && !downloadUrls.has(item.normalizedUrl))
  ) {
    return false;
  }
  return items.every((item, index) => !item.note || timelineRows[index]?.note === item.note);
}

/**
 * Đổi thứ tự các dòng hợp lệ khi kéo-thả mà vẫn giữ nguyên các dòng ghi chú (#, //), dòng trống
 * hoặc dòng không hợp lệ tại vị trí gốc trong ô nhập.
 */
export function reorderLinksTextPreservingComments(
  linksText: string,
  items: readonly ParsedInputLine[],
  sourceIndex: number,
  targetIndex: number
): string {
  const next = items.map((item) => item.originalText);
  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) return linksText;
  next.splice(targetIndex, 0, moved);

  const countByLine = new Map<number, number>();
  for (const item of items) {
    countByLine.set(item.lineNumber, (countByLine.get(item.lineNumber) ?? 0) + 1);
  }

  const rawLines = linksText.split(/\r?\n/);
  const output: string[] = [];
  let cursor = 0;
  for (let index = 0; index < rawLines.length; index += 1) {
    const count = countByLine.get(index + 1) ?? 0;
    if (count === 0) {
      output.push(rawLines[index]!);
      continue;
    }
    for (let k = 0; k < count && cursor < next.length; k += 1) {
      output.push(next[cursor]!);
      cursor += 1;
    }
  }
  while (cursor < next.length) {
    output.push(next[cursor]!);
    cursor += 1;
  }
  return output.join('\n');
}
