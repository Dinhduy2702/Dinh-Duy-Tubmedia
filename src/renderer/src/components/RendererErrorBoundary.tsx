import React from 'react';

interface State { error: Error | null; }

export class RendererErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  public state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State { return { error }; }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Giao diện gặp lỗi nghiêm trọng:', error, info.componentStack);
  }

  public render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return <div className="flex min-h-screen items-center justify-center p-8">
      <div className="card max-w-2xl p-6 text-center">
        <h1 className="text-xl font-black" style={{ color: 'var(--bad)' }}>Giao diện gặp lỗi</h1>
        <p className="mt-3 text-sm leading-6" style={{ color: 'var(--muted)' }}>Ứng dụng không còn hiển thị màn hình trống. Hãy sao chép lỗi dưới đây để sửa đúng vị trí.</p>
        <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-left text-xs" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>{this.state.error.stack ?? this.state.error.message}</pre>
        <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>Tải lại giao diện</button>
      </div>
    </div>;
  }
}
