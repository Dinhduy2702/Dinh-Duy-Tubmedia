import type { MigrationReport } from './database.js';

interface InfoLogger {
  info(module: string, eventCode: string, message: string, context?: { metadata?: Record<string, unknown> }): unknown;
}

/** Ghi vào nhật ký kết quả các migration dữ liệu cần người dùng/hỗ trợ biết (chỉ chạy một lần mỗi CSDL). */
export function logMigrationReports(reports: readonly MigrationReport[], logger: InfoLogger): void {
  for (const report of reports) {
    if (report.name === 'reset_attempts_count_failures_only') {
      logger.info(
        'database',
        'ATTEMPTS_COUNTER_RESET',
        `Đã đặt lại bộ đếm lượt thử cho ${report.changes} tác vụ chưa hoàn tất theo cách đếm mới (chỉ tính lượt thất bại).`,
        { metadata: { migration: report.version, jobs: report.changes } }
      );
    }
  }
}
