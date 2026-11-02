/**
 * 2026-11-02 (người dùng duyệt): chống lag khi tải vào ổ cứng cơ (HDD). Ca thật: ổ lưu E: là HDD, 2 danh sách vừa tải vừa tạo
 * bản dựng CapCut (23,7 GB ghi trong 30 phút) → mọi thứ khác dùng ổ E: khựng; tắt Tubmedia thì mượt lại.
 *
 * Mọi ngưỡng tự dò theo máy đang chạy — loại ổ thật của ổ đang ghi (Get-PhysicalDisk, xem hardware-service.ts), độ bận đo
 * thật (DiskBusyMonitor) và số nhân CPU; máy dev chỉ là mẫu kiểm logic.
 */

export type DiskKind = 'hdd' | 'ssd' | 'unknown';

/**
 * Độ bận (%) từ đó coi ổ là nghẽn. Ổ cứng cơ chỉ có một đầu đọc: thời gian chờ mỗi lần đọc/ghi tăng theo 1 / (1 − độ bận) —
 * bận 60% đã chậm ~2,5 lần, nên chương trình khác dùng ổ đó (CapCut, Explorer) khựng rõ trước khi ổ "đầy tải". SSD xử lý song
 * song nhiều yêu cầu nên giữ mức cũ. Ổ không rõ loại giữ mức cũ (không đoán).
 */
export function diskBusyThresholdPercent(kind: DiskKind): number {
  return kind === 'hdd' ? 60 : 85;
}

/** Các ổ đang nhận video → ngưỡng khắt khe nhất (ổ chậm nhất quyết định); không có ổ nào → mức cũ. */
export function diskBusyThresholdForDrives(letters: Iterable<string>, kindOf: (letter: string) => DiskKind): number {
  let threshold = diskBusyThresholdPercent('unknown');
  for (const letter of letters) threshold = Math.min(threshold, diskBusyThresholdPercent(kindOf(letter)));
  return threshold;
}

/**
 * Số bản dựng CapCut được mã hoá cùng lúc trên một ổ. Mỗi bản đọc video gốc (thường 4K) rồi ghi bản mới ~1 GB:
 * - HDD, hoặc ổ không rõ loại (ổ USB thường không báo loại) → 1, để đầu đọc không phải nhảy qua lại giữa nhiều tệp lớn;
 * - SSD → theo số nhân CPU (mỗi bản libx264/GPU dùng tốt ~16 luồng), tối đa 4 (giới hạn phiên mã hoá GPU phổ thông).
 */
export function editEncodeConcurrency(kind: DiskKind, logicalCpus: number): number {
  if (kind !== 'ssd') return 1;
  return Math.max(1, Math.min(4, Math.floor(Math.max(1, logicalCpus) / 16)));
}

/** Hàng chờ theo khoá (ký tự ổ) với giới hạn truyền vào mỗi lần xin lượt (giới hạn tự dò có thể đổi giữa chừng). */
export class ConcurrencyGate {
  private readonly running = new Map<string, number>();
  private readonly waiters = new Map<string, Array<{ limit: number; grant: () => void }>>();

  public acquire(key: string, limit: number, signal?: AbortSignal): Promise<() => void> {
    const max = Math.max(1, Math.trunc(limit));
    if (signal?.aborted) return Promise.reject(new Error('Đã hủy trong lúc chờ lượt.'));
    if ((this.running.get(key) ?? 0) < max && !(this.waiters.get(key)?.length)) {
      return Promise.resolve(this.take(key));
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        limit: max,
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve(this.take(key));
        }
      };
      const onAbort = (): void => {
        const queue = this.waiters.get(key) ?? [];
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error('Đã hủy trong lúc chờ lượt.'));
        this.pump(key);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const queue = this.waiters.get(key) ?? [];
      queue.push(waiter);
      this.waiters.set(key, queue);
    });
  }

  private take(key: string): () => void {
    this.running.set(key, (this.running.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running.set(key, Math.max(0, (this.running.get(key) ?? 1) - 1));
      this.pump(key);
    };
  }

  private pump(key: string): void {
    const queue = this.waiters.get(key);
    while (queue?.length && (this.running.get(key) ?? 0) < queue[0]!.limit) queue.shift()!.grant();
  }
}
