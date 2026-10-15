import { describe, expect, it } from 'vitest';
import type { QueueJob } from '../../src/shared/types/domain.js';
import { HISTORY_CSV_HEADER, historyCsvTable, historyErrorDetail } from '../../src/shared/utils/history-export.js';

// Lịch sử công việc (2026-10-12): video lỗi đã có job.errorCode / job.errorMessage cụ thể (đúng câu trong thông báo lúc lỗi),
// nhưng bảng Lịch sử và tệp CSV xuất ra không hiện — CSV thật của người dùng có 6 dòng "failed", cột Đầu ra trống, không có
// cột lý do.

const job = (overrides: Partial<QueueJob>): QueueJob => ({
  id: 'job-1',
  projectId: 'p1',
  type: 'download',
  status: 'completed',
  priority: 0,
  sourceId: null,
  itemId: null,
  input: { url: 'https://example.com/v', outputPath: 'C:\\out\\v.mp4' },
  progress: 100,
  speed: null,
  etaSeconds: null,
  attempts: 1,
  maxAttempts: 3,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-10-12T01:00:00.000Z',
  updatedAt: '2026-10-12T01:05:00.000Z',
  startedAt: '2026-10-12T01:00:01.000Z',
  finishedAt: '2026-10-12T01:05:00.000Z',
  ...overrides
});

const failed = job({
  id: 'job-2',
  status: 'failed',
  input: { url: 'https://example.com/trang-chu' },
  errorCode: 'UNSUPPORTED_URL',
  errorMessage: 'Liên kết này không được hỗ trợ: đây không phải trang của một video.'
});

describe('xuất CSV Lịch sử có lý do lỗi', () => {
  it('có thêm cột "Mã lỗi" và "Chi tiết lỗi" ở cuối', () => {
    expect(HISTORY_CSV_HEADER).toEqual(['Thời gian', 'Dự án', 'Loại', 'Trạng thái', 'Nguồn', 'Đầu ra', 'Mã lỗi', 'Chi tiết lỗi']);
  });

  it('dòng lỗi mang đúng mã lỗi và câu lỗi cụ thể; dòng không lỗi để trống hai cột này', () => {
    const [header, ok, bad] = historyCsvTable([job({}), failed], () => 'Danh sách 1', (type) => `loại ${type}`);
    expect(header).toEqual(HISTORY_CSV_HEADER);
    expect(ok).toEqual(['2026-10-12T01:05:00.000Z', 'Danh sách 1', 'loại download', 'completed', 'https://example.com/v', 'C:\\out\\v.mp4', '', '']);
    expect(bad).toEqual([
      '2026-10-12T01:05:00.000Z',
      'Danh sách 1',
      'loại download',
      'failed',
      'https://example.com/trang-chu',
      '',
      'UNSUPPORTED_URL',
      'Liên kết này không được hỗ trợ: đây không phải trang của một video.'
    ]);
  });
});

describe('lý do lỗi hiện trên bảng Lịch sử', () => {
  it('tác vụ lỗi hoặc bị gián đoạn → câu lỗi cụ thể', () => {
    expect(historyErrorDetail(failed)).toBe('Liên kết này không được hỗ trợ: đây không phải trang của một video.');
    expect(historyErrorDetail(job({ status: 'interrupted', errorCode: 'APP_SHUTDOWN', errorMessage: 'Ứng dụng đã đóng an toàn.' }))).toBe(
      'Ứng dụng đã đóng an toàn.'
    );
  });

  it('không có câu lỗi thì dùng mã lỗi; tác vụ hoàn tất không hiện lỗi cũ còn sót', () => {
    expect(historyErrorDetail(job({ status: 'failed', errorCode: 'UNHANDLED_ERROR', errorMessage: '  ' }))).toBe('Mã lỗi: UNHANDLED_ERROR');
    expect(historyErrorDetail(job({ status: 'failed' }))).toBeNull();
    expect(historyErrorDetail(job({ status: 'completed', errorCode: 'NETWORK_ERROR', errorMessage: 'lỗi của lượt trước' }))).toBeNull();
  });
});
