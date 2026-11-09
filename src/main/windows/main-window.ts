import { app, BrowserWindow, nativeTheme, shell, type Event as ElectronEvent } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDevelopmentEnvironment } from '../runtime/development-environment.js';
import { runDetached } from '../app/detached-task.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

export function createMainWindow(
  onLoadError: (error: unknown) => void = (error) => console.error('Không nạp được giao diện Tubmedia:', error),
  onOpenExternalError: (error: unknown) => void = (error) => console.error('Không mở được liên kết ngoài:', error)
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#08090c' : '#f7f7f8',
    title: 'Download video Tubmedia',
    autoHideMenuBar: true,
    // .ico đa lớp (16…256px, hint riêng từng cỡ) để icon cửa sổ/taskbar sắc nét ở mọi tỉ lệ hiển thị;
    // nằm trong resources/ nên có sẵn ở cả chế độ chạy từ mã nguồn lẫn bản đóng gói (packed vào app files).
    icon: join(app.getAppPath(), 'resources', 'icon.ico'),
    webPreferences: {
      // Sandboxed preload scripts cannot run native ESM imports. The preload
      // build is therefore emitted as one bundled CommonJS file.
      preload: join(currentDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
      backgroundThrottling: true,
      v8CacheOptions: 'code'
    }
  });

  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());


  window.webContents.on('will-attach-webview', (event: ElectronEvent) => {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    // 1.7.6: Windows không mở được link (không có trình duyệt mặc định…) → ghi lỗi, không thành unhandled rejection.
    if (url.startsWith('https://')) runDetached(() => shell.openExternal(url), onOpenExternalError);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event: ElectronEvent, url: string) => {
    const current = window.webContents.getURL();
    if (url !== current) event.preventDefault();
  });

  // 1.7.6 việc D: nạp giao diện bị từ chối (cửa sổ đóng giữa chừng, máy chủ dev tắt…) → ghi nhật ký, không thành unhandled.
  const { rendererUrl } = readDevelopmentEnvironment(process.env, app.isPackaged);
  runDetached(
    () => (rendererUrl ? window.loadURL(rendererUrl) : window.loadFile(join(currentDir, '../renderer/index.html'))),
    onLoadError
  );

  return window;
}
