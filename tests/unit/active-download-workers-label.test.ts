import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeDownloadWorkersLabel } from '@shared/utils/active-download-workers-label.js';

// Khám phá bản cài 1.5.0 (2026-10-05) #7: nhãn "Thiết lập tải đang dùng" hiện "1/danh sách" — đó là giá trị
// ĐỀ XUẤT cho 6 danh sách (planForListCount), trong khi cả 6 danh sách thật sự đang chạy 2 video cùng lúc.

describe('#7 — nhãn "Thiết lập tải đang dùng" hiện giá trị thật của các danh sách', () => {
  it('mọi danh sách cùng số video → một con số', () => {
    expect(activeDownloadWorkersLabel([2, 2, 2, 2, 2, 2])).toBe('2/danh sách · chạy song song độc lập');
    expect(activeDownloadWorkersLabel([3])).toBe('3/danh sách · chạy song song độc lập');
  });

  it('các danh sách khác nhau → nêu khoảng thấp nhất–cao nhất', () => {
    expect(activeDownloadWorkersLabel([2, 1, 4])).toBe('1–4/danh sách · chạy song song độc lập');
  });

  it('chưa có danh sách nào → không bịa số', () => {
    expect(activeDownloadWorkersLabel([])).toBe('Chưa có danh sách');
  });

  it('PreflightPanel lấy nhãn từ số video cùng lúc của các danh sách đang hiện, không từ plan.workersPerList', () => {
    const source = readFileSync('src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'utf8');
    const panel = source.slice(source.indexOf('function PreflightPanel('), source.indexOf('function Metric('));
    expect(panel).toContain('activeDownloadWorkersLabel(');
    expect(panel).not.toMatch(/status=\{plan \?/);
    const callSite = source.slice(source.indexOf('<PreflightPanel'), source.indexOf('/>', source.indexOf('<PreflightPanel')));
    expect(callSite).toContain('laneWorkers=');
  });
});
