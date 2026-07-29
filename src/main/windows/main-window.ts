import { app, BrowserWindow, nativeTheme, shell, type Event as ElectronEvent } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(process.cwd(), 'resources', 'icon.png'),
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'));
  }

  return window;
}
