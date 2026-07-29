export class AppError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ToolNotFoundError extends AppError {
  public constructor(tool: string) {
    super('TOOL_NOT_FOUND', `Không tìm thấy công cụ ${tool}.`);
  }
}
export class ToolHealthCheckError extends AppError {
  public constructor(tool: string, message: string) {
    super('TOOL_HEALTH_CHECK_FAILED', `${tool}: ${message}`);
  }
}
export class InvalidInputError extends AppError {
  public constructor(message: string) {
    super('INVALID_INPUT', message);
  }
}
export class AuthenticationRequiredError extends AppError {
  public constructor(message: string) {
    super('AUTHENTICATION_REQUIRED', message);
  }
}
export class CookiesExpiredError extends AppError {
  public constructor() {
    super(
      'COOKIES_EXPIRED',
      'Cookies đã cấu hình không còn được nền tảng chấp nhận, có thể đã hết hạn hoặc phiên đăng nhập đã bị thu hồi. ' +
        'Video liên quan đã được tạm dừng an toàn; hãy đăng nhập lại và lưu cookies mới. Ứng dụng sẽ tự tiếp tục ngay sau khi cấu hình được cập nhật.'
    );
  }
}
export class RetryWithConfiguredCookiesError extends AppError {
  public constructor() {
    super(
      'RETRY_WITH_CONFIGURED_COOKIES',
      'Video vừa yêu cầu đăng nhập. Ứng dụng sẽ tự thử lại một lần bằng cookies đã cấu hình, không làm phiền người dùng.',
      true
    );
  }
}
export class DiskFullError extends AppError {
  public constructor(path: string) {
    super('DISK_FULL', `Ổ đĩa không đủ dung lượng: ${path}`);
  }
}
export class PermissionDeniedError extends AppError {
  public constructor(path: string) {
    super('PERMISSION_DENIED', `Không có quyền truy cập: ${path}`);
  }
}
export class NetworkError extends AppError {
  public constructor(message: string) {
    super('NETWORK_ERROR', message, true);
  }
}
export class DownloadFailedError extends AppError {
  public constructor(message: string, retryable = false) {
    super('DOWNLOAD_FAILED', message, retryable);
  }
}
export class VerificationFailedError extends AppError {
  public constructor(message: string) {
    super('VERIFICATION_FAILED', message);
  }
}
export class ProcessingFailedError extends AppError {
  public constructor(message: string) {
    super('PROCESSING_FAILED', message);
  }
}
export class MergeFailedError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super('MERGE_FAILED', message, false, details);
  }
}
export class UpdateFailedError extends AppError {
  public constructor(message: string) {
    super('UPDATE_FAILED', message);
  }
}
export class RollbackFailedError extends AppError {
  public constructor(message: string) {
    super('ROLLBACK_FAILED', message);
  }
}
export class DatabaseMigrationError extends AppError {
  public constructor(message: string) {
    super('DATABASE_MIGRATION_FAILED', message);
  }
}

export class ProcessSpawnError extends AppError {
  public constructor(tool: string, message: string) {
    super('PROCESS_SPAWN_FAILED', `Không thể khởi chạy ${tool}: ${message}`, true);
  }
}
export class ProcessTimeoutError extends AppError {
  public constructor(tool: string, timeoutMs: number) {
    super(
      'PROCESS_TIMEOUT',
      `${tool} vượt quá thời gian cho phép ${Math.round(timeoutMs / 1000)} giây.`,
      true,
      { tool, timeoutMs }
    );
  }
}
export class ProcessCancelledError extends AppError {
  public constructor() {
    super('PROCESS_CANCELLED', 'Tác vụ đã bị hủy.');
  }
}

export class BrowserCookieLockedError extends AppError {
  public constructor(browser: string, profile = '') {
    const profileLabel = profile ? ` (profile: ${profile})` : '';
    super(
      'BROWSER_COOKIE_DATABASE_LOCKED',
      `${browser}${profileLabel} đang khóa cơ sở dữ liệu đăng nhập nên ứng dụng không thể đọc cookies trực tiếp. ` +
        `Hãy đóng hoàn toàn mọi cửa sổ và tiến trình ${browser}, sau đó thử lại; hoặc dùng phương án Dán cookies / Chọn file cookies.txt.`,
      false,
      { browser, profile }
    );
  }
}

export class InvalidCookieTextError extends AppError {
  public constructor(message: string) {
    super('INVALID_COOKIE_TEXT', message);
  }
}
