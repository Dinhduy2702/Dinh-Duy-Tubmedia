import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

interface StartupUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  message: string | null;
  checkedAt: string | null;
}

const STATE_CHANNEL = 'tubmedia:update-awareness:state';
const GET_STATE_CHANNEL = 'tubmedia:update-awareness:get-state';
const CHECK_CHANNEL = 'tubmedia:update-awareness:check';
const DOWNLOAD_CHANNEL = 'tubmedia:update-awareness:download';
const INSTALL_CHANNEL = 'tubmedia:update-awareness:install';

let state: StartupUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progressPercent: null,
  message: null,
  checkedAt: null
};

let initialized = false;
let checkInFlight: Promise<unknown> | null = null;
let downloadInFlight: Promise<unknown> | null = null;
let lastNotifiedVersion: string | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function publishState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(STATE_CHANNEL, state);
    }
  }
}

function patchState(patch: Partial<StartupUpdateState>): StartupUpdateState {
  state = {
    ...state,
    ...patch
  };
  publishState();
  return state;
}

function showUpdateNotification(version: string): void {
  if (lastNotifiedVersion === version) return;
  lastNotifiedVersion = version;

  try {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: 'Tubmedia có bản cập nhật mới',
      body: `Phiên bản ${version} đã sẵn sàng. Mở Tubmedia và chọn Cập nhật ngay.`,
      silent: false
    });

    notification.show();
  } catch {
    // The in-app toast remains the guaranteed notification path.
  }
}

async function checkNow(): Promise<StartupUpdateState> {
  if (!app.isPackaged) {
    return patchState({
      status: 'idle',
      message: 'Kiểm tra cập nhật chỉ chạy trên bản Tubmedia đã cài đặt.',
      checkedAt: new Date().toISOString()
    });
  }

  if (checkInFlight) {
    await checkInFlight;
    return state;
  }

  patchState({
    status: 'checking',
    message: 'Đang kiểm tra phiên bản mới...',
    checkedAt: new Date().toISOString()
  });

  checkInFlight = autoUpdater
    .checkForUpdates()
    .catch((error: unknown) => {
      patchState({
        status: state.availableVersion ? 'available' : 'error',
        message: `Không thể kiểm tra cập nhật: ${errorMessage(error)}`,
        checkedAt: new Date().toISOString()
      });
      return null;
    })
    .finally(() => {
      checkInFlight = null;
    });

  await checkInFlight;
  return state;
}

async function downloadNow(): Promise<StartupUpdateState> {
  if (!state.availableVersion) {
    await checkNow();
  }

  if (!state.availableVersion) {
    return state;
  }

  if (downloadInFlight) {
    await downloadInFlight;
    return state;
  }

  patchState({
    status: 'downloading',
    progressPercent: 0,
    message: `Đang tải Tubmedia ${state.availableVersion}...`
  });

  downloadInFlight = autoUpdater
    .downloadUpdate()
    .catch((error: unknown) => {
      patchState({
        status: 'available',
        message: `Tải cập nhật thất bại: ${errorMessage(error)}`
      });
      return [];
    })
    .finally(() => {
      downloadInFlight = null;
    });

  await downloadInFlight;
  return state;
}

function installNow(): StartupUpdateState {
  if (state.status !== 'downloaded') {
    return state;
  }

  autoUpdater.quitAndInstall(false, true);
  return state;
}

// AppUpdateService is the sole updater policy owner.
// This module is intentionally limited to startup awareness, events,
// desktop/in-app notification state and explicit user actions.
export function initializeStartupUpdateAwareness(): void {
  if (initialized) return;
  initialized = true;

  // User-driven install: notify immediately, download only after the user clicks.

  autoUpdater.on('checking-for-update', () => {
    patchState({
      status: 'checking',
      message: 'Đang kiểm tra phiên bản mới...',
      checkedAt: new Date().toISOString()
    });
  });

  autoUpdater.on('update-available', (info) => {
    patchState({
      status: 'available',
      availableVersion: info.version,
      progressPercent: null,
      message: `Có bản Tubmedia ${info.version}.`,
      checkedAt: new Date().toISOString()
    });

    showUpdateNotification(info.version);
  });

  autoUpdater.on('update-not-available', () => {
    patchState({
      status: 'idle',
      availableVersion: null,
      progressPercent: null,
      message: null,
      checkedAt: new Date().toISOString()
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    patchState({
      status: 'downloading',
      progressPercent: Math.max(0, Math.min(100, progress.percent)),
      message: `Đang tải cập nhật ${progress.percent.toFixed(0)}%...`
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    patchState({
      status: 'downloaded',
      availableVersion: info.version,
      progressPercent: 100,
      message: `Tubmedia ${info.version} đã tải xong. Sẵn sàng cài đặt.`
    });
  });

  autoUpdater.on('error', (error) => {
    patchState({
      status: state.availableVersion ? 'available' : 'error',
      message: `Cập nhật gặp lỗi: ${errorMessage(error)}`
    });
  });

  ipcMain.handle(GET_STATE_CHANNEL, () => state);
  ipcMain.handle(CHECK_CHANNEL, () => checkNow());
  ipcMain.handle(DOWNLOAD_CHANNEL, () => downloadNow());
  ipcMain.handle(INSTALL_CHANNEL, () => installNow());

  // Startup requirement: check shortly after the first window can become usable.
  setTimeout(() => {
    void checkNow();
  }, 1800);

  // Keep long-running Tubmedia sessions aware of releases without user action.
  setInterval(
    () => {
      void checkNow();
    },
    6 * 60 * 60 * 1000
  );
}

void app.whenReady().then(() => {
  initializeStartupUpdateAwareness();
});
