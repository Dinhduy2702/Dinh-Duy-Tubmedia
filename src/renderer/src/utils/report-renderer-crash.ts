/** 1.8.0: gửi lỗi sập giao diện (ErrorBoundary) về tiến trình chính để tự lưu báo cáo JSON, không hiện ra người dùng. */
export function reportRendererCrash(
  error: Error,
  componentStack: string | null | undefined,
  supportCode: string
): void {
  const stackText = typeof error.stack === 'string' ? error.stack : '';
  void window.desktop?.errorReport
    ?.reportRenderer?.({
      name: error.name,
      message: error.message || 'Lỗi giao diện không xác định',
      ...(stackText ? { stack: stackText } : {}),
      ...(componentStack ? { componentStack } : {}),
      ...(supportCode ? { supportCode } : {})
    })
    .catch(() => undefined);
}
