import { readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildQuickDownloadArguments } from '../../src/main/download/quick-download-command.js';
import { validateQuickDownloadRequest } from '../../src/shared/quick-download.js';
import { recommendedConcurrentFragments } from '../../src/shared/utils/hardware-recommendation.js';

// 2026-10-24 (nguyên tắc tự dò theo máy, người dùng duyệt): Tải nhanh trước đây luôn 4 mảnh mỗi video trên MỌI máy.
const paths = { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\Temp\\quick', runToken: 'token' };
const request = validateQuickDownloadRequest({
  url: 'https://example.com/video',
  outputDirectory: 'D:\\Video',
  mediaMode: 'video-audio',
  quality: 'best',
  mode: 'full',
  accurateCut: false
});
const fragmentsOf = (args: string[]): string | undefined => args[args.indexOf('--concurrent-fragments') + 1];

describe('Tải nhanh — số mảnh tải mỗi video theo máy', () => {
  it('không truyền số mảnh: dò theo máy đang chạy (không còn cố định 4)', () => {
    expect(fragmentsOf(buildQuickDownloadArguments(request, paths))).toBe(
      String(recommendedConcurrentFragments(cpus().length, totalmem()))
    );
  });

  it('dùng đúng số được truyền vào, giới hạn 1–8', () => {
    expect(fragmentsOf(buildQuickDownloadArguments(request, paths, undefined, { concurrentFragments: 1 }))).toBe('1');
    expect(fragmentsOf(buildQuickDownloadArguments(request, paths, undefined, { concurrentFragments: 6 }))).toBe('6');
    expect(fragmentsOf(buildQuickDownloadArguments(request, paths, undefined, { concurrentFragments: 50 }))).toBe('8');
    expect(fragmentsOf(buildQuickDownloadArguments(request, paths, undefined, { concurrentFragments: 0 }))).toBe('1');
  });

  it('dịch vụ Tải nhanh lấy số mảnh từ cùng ô Cài đặt "Mảnh tải đồng thời mỗi video" (tự động/tự chọn)', () => {
    const service = readFileSync('src/main/download/quick-download-service.ts', 'utf8');
    expect(service).toContain('concurrentFragments: this.concurrentFragments()');
    expect(service).toContain('effectiveConcurrentFragments(settings, cpus().length, totalmem())');
  });
});
