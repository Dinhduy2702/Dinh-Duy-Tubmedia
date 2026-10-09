import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// vi-labels.ts thuộc dự án TypeScript của giao diện (tsconfig.web.json) nên không import tĩnh được từ test (tsconfig.node);
// nạp lúc chạy để vẫn gọi đúng hàm thật.
const labelsModule = '../../src/renderer/src/utils/vi-labels.js';
const { statusLabel } = (await import(labelsModule)) as { statusLabel: (status: string) => string };

// Đợt 5 (rà soát bản cài 2026-10-02): huy hiệu ở đầu thẻ Danh sách tải / Quy trình ghép chưa có tác vụ hiện chữ tiếng Anh
// "idle" — statusLabel không có nhãn cho trạng thái này nên trả nguyên mã. MỌI trạng thái huy hiệu có thể nhận phải có nhãn
// tiếng Việt.

/** Lấy các giá trị của một union chuỗi trong tệp kiểu (để test tự theo khi thêm trạng thái mới). */
function unionValues(file: string, typeName: string): string[] {
  const source = readFileSync(file, 'utf8');
  const match = new RegExp(`(?:export )?type ${typeName} =([^;]+);`).exec(source);
  if (!match) throw new Error(`không thấy kiểu ${typeName}`);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((item) => item[1]!);
}

function workflowStates(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const match = /function workflowState\([^)]*\): ([^{]+)\{/.exec(source);
  if (!match) throw new Error(`không thấy workflowState trong ${file}`);
  const signature = match[1]!.trim();
  const union = signature.includes("'") ? signature : unionValues(file, signature).map((item) => `'${item}'`).join(' | ');
  return [...union.matchAll(/'([^']+)'/g)].map((item) => item[1]!);
}

describe('nhãn trạng thái tiếng Việt cho mọi trạng thái huy hiệu có thể nhận', () => {
  const domain = 'src/shared/types/domain.ts';
  const statuses = new Set<string>([
    ...unionValues(domain, 'JobStatus'),
    ...unionValues(domain, 'ProjectStatus'),
    // Trạng thái thẻ Danh sách tải / Quy trình ghép (huy hiệu đầu thẻ).
    ...workflowStates('src/renderer/src/pages/DownloadWorkbenchPage.tsx'),
    ...workflowStates('src/renderer/src/pages/DownloadMergePage.tsx'),
    // Công cụ, liên kết nhập, mức nhật ký.
    'healthy', 'warning', 'broken', 'valid', 'invalid', 'debug', 'info', 'warn', 'error'
  ]);

  it('đã gom đủ trạng thái (có idle của thẻ chưa chạy)', () => {
    expect(statuses.has('idle')).toBe(true);
    expect(statuses.size).toBeGreaterThan(25);
  });

  for (const status of statuses) {
    it(`"${status}" có nhãn tiếng Việt`, () => {
      const label = statusLabel(status);
      expect(label, status).not.toBe(status);
      expect(label, status).not.toMatch(/^[a-z_-]+$/);
    });
  }

  it('thẻ chưa có tác vụ ghi "Chưa bắt đầu"', () => {
    expect(statusLabel('idle')).toBe('Chưa bắt đầu');
  });
});
