import ReactDOM from 'react-dom/client';
import * as Tooltip from '@radix-ui/react-tooltip';
import { App } from './app/App';
import { RendererErrorBoundary } from './components/RendererErrorBoundary';
import './styles.css';
import './tubmedia-theme.css';
import './system-cleanup.css';
import './quick-download.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Không tìm thấy vùng hiển thị chính của giao diện.');
}

const root = ReactDOM.createRoot(rootElement);

if (typeof window.desktop === 'undefined') {
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        background: '#090b10',
        color: '#f8fafc',
        fontFamily: 'Segoe UI, sans-serif'
      }}
    >
      <div style={{ maxWidth: 720, textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>Download video Tubmedia chưa thể khởi động</h1>
        <p style={{ marginTop: 14, lineHeight: 1.6, color: '#9ca8b9' }}>
          Cầu nối bảo mật không hoạt động nên giao diện không thể kết nối với phần xử lý chính của ứng dụng.
          Hãy đóng ứng dụng, chạy lại lệnh xây dựng rồi mở ứng dụng lại.
        </p>
      </div>
    </div>
  );
} else {
  root.render(
    <Tooltip.Provider delayDuration={300}>
      <RendererErrorBoundary>
        <App />
      </RendererErrorBoundary>
    </Tooltip.Provider>
  );
}
