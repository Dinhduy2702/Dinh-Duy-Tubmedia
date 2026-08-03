import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  powerSaveBlocker,
  session,
  Tray,
  type Event as ElectronEvent
} from 'electron';
import { join } from 'node:path';
import { IPC } from '@shared/contracts/channels.js';
import { AppContext } from './app/app-context.js';
import { registerIpc } from './ipc/register-ipc.js';
import { createMainWindow } from './windows/main-window.js';
import { REQUIRED_TOOL_NAMES } from './tools/tool-manager.js';

let context: AppContext | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let statsTimer: NodeJS.Timeout | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let updateInitialTimer: NodeJS.Timeout | null = null;
let powerSaveBlockerId: number | null = null;
let shutdownStarted = false;
let shutdownMode: 'preserve' | 'cancel' = 'preserve';
let allowWindowClose = false;

const isE2E = process.env.TUBMEDIA_E2E === '1';
const e2eUserData = process.env.TUBMEDIA_E2E_USER_DATA;

if (isE2E && e2eUserData) {
  app.setPath('userData', e2eUserData);
}

app.setAppUserModelId('com.tubmedia.download-video');

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function ensureTray(): void {
  if (tray) return;
  const icon = nativeImage
    .createFromPath(join(app.getAppPath(), 'resources', 'icon.png'))
    .resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('Download video Tubmedia');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở ứng dụng', click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Thoát an toàn',
        click: () => {
          shutdownMode = 'preserve';
          allowWindowClose = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('double-click', showMainWindow);
}

async function requestClose(window: BrowserWindow): Promise<void> {
  if (!context || allowWindowClose) return;
  const settings = context.settings.get();
  const active = context.queue.activeCount() + (context.quickDownload.isActive() ? 1 : 0);

  if (settings.closeBehavior === 'tray' || settings.minimizeToTray) {
    ensureTray();
    window.hide();
    return;
  }

  if (active === 0) {
    allowWindowClose = true;
    window.close();
    return;
  }

  let action = settings.closeBehavior;
  if (action === 'ask') {
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Đang có tác vụ chạy',
      message: `Hiện có ${active} tác vụ đang chạy.`,
      detail:
        'Tạm dừng và đóng sẽ giữ trạng thái để tiếp tục ở lần mở sau. Hủy và đóng sẽ kết thúc các tác vụ hiện tại.',
      buttons: ['Tạm dừng và đóng', 'Hủy tác vụ và đóng', 'Quay lại'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (result.response === 2) return;
    action = result.response === 1 ? 'cancel_and_exit' : 'pause_and_exit';
  }

  shutdownMode = action === 'cancel_and_exit' ? 'cancel' : 'preserve';
  if (shutdownMode === 'cancel') context.queue.cancelAllActive();
  allowWindowClose = true;
  app.quit();
}

function wireWindow(window: BrowserWindow): void {
  if (!context) return;
  context.sender.setWebContents(window.webContents);
  context.logger.setWindow(window);
  context.queue.setWindow(window);
  context.tools.setWindow(window);
  context.appUpdates.setWindow(window);
  window.on('close', (event: ElectronEvent) => {
    if (allowWindowClose) return;
    event.preventDefault();
    void requestClose(window);
  });
}

async function connectToolsAtStartup(current: AppContext): Promise<void> {
  const required = new Set<string>(REQUIRED_TOOL_NAMES);
  const final = await current.tools.ensureRequiredReady();
  const ready = final.filter(
    (tool) =>
      required.has(tool.name) && tool.available && tool.health !== 'broken' && Boolean(tool.executablePath)
  ).length;
  const recovered = current.tools.requiredReady() ? current.queue.recoverToolBlocked() : 0;
  current.logger.info(
    'tools',
    'TOOLS_AUTO_CONNECTED',
    `Đã tự động dò, tải nếu thiếu và kiểm tra công cụ khi khởi động (${ready}/${required.size} công cụ bắt buộc sẵn sàng` +
      `${recovered > 0 ? `; khôi phục ${recovered} tác vụ từng bị chặn` : ''}).`
  );
}

async function runBackgroundUpdateChecks(current: AppContext): Promise<void> {
  if (current.settings.get().autoCheckToolUpdates) {
    await current.toolUpdates.check().catch((error: unknown) => {
      current.logger.warn(
        'update',
        'TOOL_UPDATE_CHECK_FAILED',
        error instanceof Error ? error.message : String(error)
      );
    });
  }
  if (current.settings.get().autoCheckAppUpdates) {
    await current.appUpdates.check(true).catch((error: unknown) => {
      current.logger.warn(
        'update',
        'APP_UPDATE_CHECK_FAILED',
        error instanceof Error ? error.message : String(error)
      );
    });
  }
}

function syncPowerSaveBlocker(current: AppContext): void {
  const hasActiveWork = current.queue.activeCount() > 0 || current.quickDownload.isActive();
  if (hasActiveWork && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    current.logger.info(
      'app',
      'POWER_SAVE_BLOCKER_STARTED',
      'Đã tạm ngăn máy ngủ trong khi tác vụ đang xử lý.'
    );
    return;
  }
  if (!hasActiveWork && powerSaveBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerSaveBlockerId)) powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
    current.logger.info(
      'app',
      'POWER_SAVE_BLOCKER_STOPPED',
      'Đã trả lại chế độ ngủ bình thường của Windows.'
    );
  }
}

function startStatsTimer(): void {
  statsTimer = setInterval(() => {
    const currentWindow = mainWindow;
    const currentContext = context;
    if (!currentContext) return;
    syncPowerSaveBlocker(currentContext);
    if (
      !currentWindow ||
      currentWindow.isDestroyed() ||
      currentWindow.isMinimized() ||
      !currentWindow.isVisible()
    )
      return;
    void currentContext.systemStats.sample().then((stats) => {
      if (!currentWindow.isDestroyed() && currentWindow.isVisible() && !currentWindow.isMinimized()) {
        currentWindow.webContents.send(IPC.events.systemStats, stats);
      }
    });
  }, 2_000);
}

function startUpdateScheduler(current: AppContext): void {
  const check = (): void => {
    if (!current.settings.get().autoCheckAppUpdates) return;
    const status = current.appUpdates.getStatus();
    if (status.state === 'checking' || status.state === 'downloading' || status.state === 'installing')
      return;
    const checkedAt = status.checkedAt ? Date.parse(status.checkedAt) : 0;
    if (Number.isFinite(checkedAt) && Date.now() - checkedAt < 5 * 60 * 1_000) return;
    void current.appUpdates.check(true);
  };
  updateInitialTimer = setTimeout(check, 25_000);
  updateTimer = setInterval(check, 6 * 60 * 60 * 1_000);
}

function initializeApplication(): void {
  Menu.setApplicationMenu(null);
  // Tubmedia không cần camera, micro, vị trí hoặc thông báo hệ thống từ nội dung web.
  // Từ chối mặc định giúp một URL/renderer bị lỗi không thể tự xin quyền nhạy cảm.
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  );
  const prepareForAppUpdate = async (): Promise<void> => {
    const activeContext = context;
    if (!activeContext || shutdownStarted) return;
    // quitAndInstall phải được phép sở hữu quá trình thoát. Nếu before-quit tự
    // gọi app.exit(), NSIS updater có thể không kịp thay thế bản cài đặt.
    shutdownStarted = true;
    shutdownMode = 'preserve';
    allowWindowClose = true;
    if (statsTimer) clearInterval(statsTimer);
    if (updateTimer) clearInterval(updateTimer);
    if (updateInitialTimer) clearTimeout(updateInitialTimer);
    await activeContext.quickDownload.shutdown(true);
    await activeContext.queue.stop(true);
    await activeContext.processes.shutdown();
    await activeContext.logger.flush();
    activeContext.database.close();
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
    tray?.destroy();
    tray = null;
  };
  const current = new AppContext(prepareForAppUpdate);
  context = current;
  current.initialize();
  const startupTools = connectToolsAtStartup(current)
    .catch((error: unknown) => {
      current.logger.warn(
        'tools',
        'TOOLS_AUTO_CONNECT_FAILED',
        error instanceof Error ? error.message : String(error)
      );
    })
    .finally(() => {
      // Hàng đợi chỉ được khôi phục sau khi trạng thái công cụ đã được xác định.
      // Cổng canExecute trong QueueManager tiếp tục giữ tác vụ nếu công cụ bắt buộc vẫn thiếu.
      current.queue.start();
    });
  // Giao diện được mở ngay với dữ liệu local. Kiểm tra/sửa công cụ vẫn chạy
  // tự động ở nền; QueueManager chỉ khởi động sau khi ba công cụ bắt buộc đã
  // được xác định để không tạo trạng thái sẵn sàng giả.
  registerIpc(current);
  mainWindow = createMainWindow();
  wireWindow(mainWindow);
  void startupTools.then(async () => {
    await Promise.allSettled([current.tools.healthCheckOptional(), runBackgroundUpdateChecks(current)]);
  });

  if (current.settings.get().minimizeToTray || current.settings.get().closeBehavior === 'tray') {
    ensureTray();
  }
  startStatsTimer();
  startUpdateScheduler(current);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      wireWindow(mainWindow);
    } else {
      showMainWindow();
    }
  });
}

const lock = isE2E || app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  void app
    .whenReady()
    .then(initializeApplication)
    .catch((error: unknown) => {
      console.error(error);
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('before-quit', (event: ElectronEvent) => {
  if (!context || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  const current = context;
  context = null;
  if (statsTimer) clearInterval(statsTimer);
  if (updateTimer) clearInterval(updateTimer);
  if (updateInitialTimer) clearTimeout(updateInitialTimer);

  void (async () => {
    await current.quickDownload.shutdown(shutdownMode === 'preserve');
    await current.queue.stop(shutdownMode === 'preserve');
    await current.processes.shutdown();
    await current.logger.flush();
    current.database.close();
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
    tray?.destroy();
    app.exit(0);
  })();
});
