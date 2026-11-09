import { app, shell, type WebContents } from 'electron';
import { runDetached } from '../app/detached-task.js';

app.setAppUserModelId('com.tubmedia.download-video');
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
// 1.7.6: Windows không mở được link (không có trình duyệt mặc định…) → ghi lỗi, không thành unhandled rejection.
function logOpenExternalFailure(error: unknown): void {
  console.error('Không mở được liên kết ngoài:', error);
}
function isSafeExternalUrl(value: string): boolean {
  const parsed = parseUrl(value);
  return parsed?.protocol === 'https:';
}
function isTrustedInternalNavigation(contents: WebContents, targetUrl: string): boolean {
  const target = parseUrl(targetUrl);
  if (!target) return false;
  const currentRaw = contents.getURL();
  if (!currentRaw) {
    if (target.protocol === 'file:') return true;
    return (
      (target.protocol === 'http:' || target.protocol === 'https:') &&
      (target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname === '[::1]')
    );
  }
  const current = parseUrl(currentRaw);
  if (!current) return false;
  if (current.protocol === 'file:') {
    return (
      target.protocol === 'file:' &&
      decodeURIComponent(target.pathname) === decodeURIComponent(current.pathname)
    );
  }
  return target.protocol === current.protocol && target.origin === current.origin;
}
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) runDetached(() => shell.openExternal(url), logOpenExternalFailure);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isTrustedInternalNavigation(contents, url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) runDetached(() => shell.openExternal(url), logOpenExternalFailure);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
export const tubmediaElectronSecurityGuardInstalled = true;
