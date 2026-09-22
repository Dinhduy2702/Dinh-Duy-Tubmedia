import { app, BrowserWindow, nativeTheme, shell, type Event as ElectronEvent } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDevelopmentEnvironment } from '../runtime/development-environment.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
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
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event: ElectronEvent, url: string) => {
    const current = window.webContents.getURL();
    if (url !== current) event.preventDefault();
  });

  const { rendererUrl } = readDevelopmentEnvironment(process.env, app.isPackaged);
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'));
  }

  return window;
}
