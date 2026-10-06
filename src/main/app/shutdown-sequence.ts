/**
 * Chuỗi dọn dẹp khi thoát, KHÔNG BAO GIỜ treo (sau phát hành 1.6.0, 2026-10-06: người dùng bấm X nhưng app không
 * thoát hẳn, phải End Task). Trước đây before-quit chờ từng bước không giới hạn thời gian — một bước không kết thúc
 * (ví dụ hàng đợi chờ tác vụ đang bị treo) là app sống mãi mà không có cửa sổ, cũng không để lại dấu vết.
 *
 * - Mỗi bước có giới hạn riêng; quá giờ thì ghi lại và CHUYỂN SANG BƯỚC SAU (bước giết tiến trình con vẫn chạy).
 * - Tổng quá `totalTimeoutMs` thì bỏ qua các bước còn lại và báo `forced` để nơi gọi buộc thoát.
 * - Mọi diễn biến ghi qua `trail` (nơi gọi ghi đồng bộ ra logs\shutdown.log) để lần sau có bằng chứng.
 */
export interface ShutdownStep {
  name: string;
  timeoutMs: number;
  run: () => Promise<void> | void;
}

export interface ShutdownStepResult {
  name: string;
  status: 'ok' | 'error' | 'timeout' | 'skipped';
  ms: number;
  error?: string;
}

export interface ShutdownReport {
  steps: ShutdownStepResult[];
  totalMs: number;
  /** true: hết tổng thời gian cho phép, các bước còn lại bị bỏ qua. */
  forced: boolean;
}

const TIMED_OUT = Symbol('timeout');

export async function runShutdownSequence(
  steps: readonly ShutdownStep[],
  options: { totalTimeoutMs: number; trail: (line: string) => void; now?: () => number }
): Promise<ShutdownReport> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const results: ShutdownStepResult[] = [];
  let forced = false;

  for (const step of steps) {
    const remaining = options.totalTimeoutMs - (now() - startedAt);
    if (remaining <= 0) {
      forced = true;
      results.push({ name: step.name, status: 'skipped', ms: 0 });
      options.trail(`  ${step.name}: BỎ QUA — đã hết ${options.totalTimeoutMs} ms cho phép`);
      continue;
    }
    const limit = Math.min(step.timeoutMs, remaining);
    const stepStart = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        Promise.resolve().then(() => step.run()),
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), limit);
        })
      ]);
      const ms = now() - stepStart;
      if (outcome === TIMED_OUT) {
        results.push({ name: step.name, status: 'timeout', ms });
        options.trail(`  ${step.name}: QUÁ GIỜ sau ${ms} ms (giới hạn ${limit} ms) — chuyển sang bước sau`);
        if (limit < step.timeoutMs) forced = true;
      } else {
        results.push({ name: step.name, status: 'ok', ms });
        options.trail(`  ${step.name}: ok (${ms} ms)`);
      }
    } catch (error) {
      const ms = now() - stepStart;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: step.name, status: 'error', ms, error: message });
      options.trail(`  ${step.name}: LỖI sau ${ms} ms — ${message}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return { steps: results, totalMs: now() - startedAt, forced };
}
