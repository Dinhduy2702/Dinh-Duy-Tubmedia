import React from 'react';

interface State {
  error: Error | null;
  supportCode: string;
}

export class RendererErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  public state: State = { error: null, supportCode: '' };

  public static getDerivedStateFromError(error: Error): State {
    return {
      error,
      supportCode: `UI-${Date.now().toString(36).toUpperCase()}`
    };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Giao diện gặp lỗi nghiêm trọng:', error, info.componentStack);
  }

  public render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="card max-w-2xl p-6 text-center">
          <h1 className="text-xl font-black" style={{ color: 'var(--bad)' }}>
            Giao diện cần được tải lại
          </h1>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--muted)' }}>
            Một thành phần hiển thị vừa gặp sự cố. Công việc và dữ liệu đã lưu không bị xóa. Hãy tải lại giao
            diện; nếu tình trạng lặp lại, mở trang Nhật ký và gửi mã hỗ trợ bên dưới.
          </p>
          <div className="mt-4 rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>
            Mã hỗ trợ: <b>{this.state.supportCode}</b>
          </div>
          <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>
            Tải lại giao diện
          </button>
        </div>
      </div>
    );
  }
}
