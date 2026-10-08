import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/shared/types/domain.js';
import { pickLiveDiagnostic } from '../../src/shared/utils/diagnostic-policy.js';

// Đợt 3 mục 8 (rà soát bản cài 1.5.0), câu duyệt gốc: "toast chỉ hiện cho sự kiện mới phát sinh, không hiện lại lỗi cũ khi
// tải lịch sử, và phải tắt được". Trước đây khung chẩn đoán xét MỌI dòng trong kho (kể cả dòng nạp từ lịch sử lúc mở app,
// trang Nhật ký, trang Chẩn đoán) và chỉ chặn bằng tuổi ≤ 12 giây — mở lại app ngay sau một lỗi thì lỗi cũ bật lại.

interface StoreLike {
  getState(): {
    logs: LogEntry[];
    liveLogIds: ReadonlySet<string>;
    pushLogs(entries: LogEntry[]): void;
    receiveLiveLogs(entries: LogEntry[]): void;
  };
  setState(partial: Record<string, unknown>): void;
}
const storeModulePath = '../../src/renderer/src/stores/app-store.js';
const { useAppStore } = (await import(/* @vite-ignore */ storeModulePath)) as { useAppStore: StoreLike };

const now = Date.parse('2026-10-08T10:00:00Z');
const entry = (id: string, overrides: Partial<LogEntry> = {}): LogEntry => ({
  id,
  timestamp: new Date(now - 2_000).toISOString(),
  level: 'error',
  module: 'app',
  eventCode: 'APP_ERROR',
  message: `lỗi ${id}`,
  ...overrides
});

describe('khung chẩn đoán chỉ hiện sự kiện mới phát sinh', () => {
  it('dòng lỗi MỚI (dưới 12 giây) nhưng nạp từ lịch sử → không hiện', () => {
    expect(pickLiveDiagnostic([entry('cu')], new Set(), [], new Set(), now)).toBeNull();
  });

  it('dòng lỗi đến trực tiếp trong phiên → hiện; đã tắt loại đó → không hiện', () => {
    const live = entry('moi');
    expect(pickLiveDiagnostic([live], new Set(['moi']), [], new Set(), now)?.id).toBe('moi');
    expect(pickLiveDiagnostic([live], new Set(['moi']), [], new Set(['app:APP_ERROR']), now)).toBeNull();
  });

  it('dòng trực tiếp đã quá 12 giây → không hiện (giữ quy tắc cũ)', () => {
    const old = entry('moi', { timestamp: new Date(now - 60_000).toISOString() });
    expect(pickLiveDiagnostic([old], new Set(['moi']), [], new Set(), now)).toBeNull();
  });

  it('kho: nạp lịch sử (pushLogs) không đánh dấu trực tiếp; nhận sự kiện (receiveLiveLogs) có đánh dấu', () => {
    useAppStore.setState({ logs: [], liveLogIds: new Set() });
    useAppStore.getState().pushLogs([entry('lich-su')]);
    useAppStore.getState().receiveLiveLogs([entry('truc-tiep')]);
    const state = useAppStore.getState();
    expect(state.logs.map((log) => log.id).sort()).toEqual(['lich-su', 'truc-tiep']);
    expect(state.liveLogIds.has('truc-tiep')).toBe(true);
    expect(state.liveLogIds.has('lich-su')).toBe(false);
  });

  it('chỉ đường sự kiện trực tiếp dùng receiveLiveLogs; khung chẩn đoán dùng pickLiveDiagnostic; có nút đóng', () => {
    expect(readFileSync('src/renderer/src/hooks/use-desktop-events.ts', 'utf8')).toContain('receiveLiveLogs(');
    const dock = readFileSync('src/renderer/src/components/DiagnosticDock.tsx', 'utf8');
    expect(dock).toContain('pickLiveDiagnostic(');
    expect(dock).toContain('aria-label="Đóng thông báo này"');
  });
});
