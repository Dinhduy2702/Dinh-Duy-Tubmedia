import './runtime/electron-security-guard.js'; // TUBMEDIA_ELECTRON_SECURITY_GUARD
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
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '@shared/contracts/channels.js';
import type { AppUpdateStatus } from '@shared/types/domain.js';
import { AppContext } from './app/app-context.js';
import { decideCloseAction, decideMinimizeAction } from './app/window-close-policy.js';
import { runShutdownSequence, type ShutdownStep } from './app/shutdown-sequence.js';
import { registerIpc } from './ipc/register-ipc.js';
import { createMainWindow } from './windows/main-window.js';
import { readDevelopmentEnvironment } from './runtime/development-environment.js';
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

const developmentEnvironment = readDevelopmentEnvironment(process.env, app.isPackaged);
const { e2e: isE2E, e2eUserData, fakeUpdateStatusJson, e2eShutdownHangStep, e2eQueueStartDelayMs } = developmentEnvironment;

if (isE2E && e2eUserData) {
  app.setPath('userData', e2eUserData);
  // Sandbox luôn cả thư mục Tải xuống mặc định trong lúc kiểm thử e2e — QuickDownloadService dùng
  // app.getPath('downloads') làm thư mục lưu mặc định; nếu không đổi, một kịch bản e2e tải video thật
  // (không chỉ định rõ outputDirectory) sẽ vô tình ghi vào thư mục Downloads THẬT của máy đang chạy.
  // Downloads thật của Windows luôn tồn tại sẵn nên chỗ này phải tự tạo thư mục sandbox tương ứng.
  const e2eDownloads = join(e2eUserData, 'e2e-downloads');
  mkdirSync(e2eDownloads, { recursive: true });
  app.setPath('downloads', e2eDownloads);
}

app.setAppUserModelId('com.tubmedia.download-video');

const SHUTDOWN_TOTAL_TIMEOUT_MS = 15_000;
/** Chốt chặn cuối, độc lập với chuỗi dọn dẹp: phòng trường hợp chính chuỗi không trả về. */
const SHUTDOWN_WATCHDOG_MS = SHUTDOWN_TOTAL_TIMEOUT_MS + 2_000;

/** Ghi đồng bộ ra logs\shutdown.log — vẫn ghi được kể cả khi bộ ghi nhật ký chính bị treo. Không bao giờ ném lỗi. */
function createShutdownTrail(userData: string): (line: string) => void {
  const file = join(userData, 'logs', 'shutdown.log');
  return (line: string) => {
    try {
      mkdirSync(join(userData, 'logs'), { recursive: true });
      appendFileSync(file, `${new Date().toISOString()} [pid ${process.pid}] ${line}\n`, 'utf8');
    } catch {
      // Không ghi được nhật ký thoát thì vẫn phải thoát.
    }
  };
}

/** Các bước dọn dẹp khi thoát, mỗi bước có giới hạn thời gian riêng (tổng tối đa SHUTDOWN_TOTAL_TIMEOUT_MS). */
function buildShutdownSteps(current: AppContext, preserve: boolean): ShutdownStep[] {
  const steps: ShutdownStep[] = [
    { name: 'quickDownload', timeoutMs: 4_000, run: () => current.quickDownload.shutdown(preserve) },
    // Hàng đợi chờ tác vụ đang chạy kết thúc; quá giờ thì bước "processes" ngay sau sẽ giết tiến trình con.
    { name: 'queue', timeoutMs: 6_000, run: () => current.queue.stop(preserve) },
    { name: 'processes', timeoutMs: 4_000, run: () => current.processes.shutdown() },
    { name: 'logger', timeoutMs: 2_000, run: () => current.logger.flush() },
    { name: 'database', timeoutMs: 1_000, run: () => current.database.close() },
    {
      name: 'powerSaveBlocker',
      timeoutMs: 1_000,
      run: () => {
        if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
          powerSaveBlocker.stop(powerSaveBlockerId);
          powerSaveBlockerId = null;
        }
      }
    },
    { name: 'tray', timeoutMs: 1_000, run: () => tray?.destroy() }
  ];
  // Chỉ ở chế độ e2e: cố ý làm treo một bước để kiểm chứng app vẫn thoát hẳn (bài e2e "Thoát an toàn").
  return e2eShutdownHangStep
    ? steps.map((step) => (step.name === e2eShutdownHangStep ? { ...step, run: () => new Promise<void>(() => undefined) } : step))
    : steps;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function ensureTray(): void {
  if (tray) return;
  // .ico đa lớp (đã hint riêng 16/20/24/32px cho khay hệ thống): không resize() một ảnh lớn (làm mờ),
  // để Windows tự chọn đúng khung theo tỉ lệ hiển thị màn hình.
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.ico'));
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
  let action = decideCloseAction({ closeBehavior: settings.closeBehavior, activeCount: active });

  if (action === 'hide-to-tray') {
    ensureTray();
    window.hide();
    return;
  }

  if (action === 'quit') {
    // Gọi thẳng app.quit(): `window-all-closed` bỏ qua việc thoát khi đã có biểu tượng khay (tạo lúc mở app
    // nếu bật công tắc, hoặc sau lần thu nhỏ xuống khay) — chỉ đóng cửa sổ sẽ để app chạy ẩn.
    shutdownMode = 'preserve';
    allowWindowClose = true;
    app.quit();
    return;
  }

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
  // Công tắc "Thu nhỏ xuống khay hệ thống" chỉ áp dụng cho nút thu nhỏ (—), không ảnh hưởng nút X.
  window.on('minimize', () => {
    if (!context) return;
    if (decideMinimizeAction({ minimizeToTray: context.settings.get().minimizeToTray }) !== 'hide-to-tray') return;
    ensureTray();
    window.hide();
    // Lần đầu: cửa sổ biến mất khỏi thanh tác vụ nên dễ tưởng app đã đóng — nhắc bằng thông báo của Windows.
    if (context.settings.consumeTrayMinimizeHint()) {
      tray?.displayBalloon({
        iconType: 'info',
        title: 'Tubmedia vẫn đang chạy',
        content:
          'Ứng dụng đã thu nhỏ xuống khay hệ thống (góc phải dưới, cạnh đồng hồ). Bấm biểu tượng Tubmedia để mở lại; ' +
          'chuột phải → "Thoát an toàn" để tắt hẳn.'
      });
      context.logger.info('app', 'TRAY_MINIMIZE_HINT_SHOWN', 'Đã nhắc lần đầu: nút thu nhỏ ẩn ứng dụng xuống khay hệ thống.');
    }
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
    void currentContext.systemStats
      .sample()
      .then((stats) => {
        if (!currentWindow.isDestroyed() && currentWindow.isVisible() && !currentWindow.isMinimized()) {
          currentWindow.webContents.send(IPC.events.systemStats, stats);
        }
      })
      .catch((error: unknown) => {
        currentContext.logger.debug(
          'app',
          'SYSTEM_STATS_SAMPLE_FAILED',
          error instanceof Error ? error.message : String(error)
        );
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
    void current.appUpdates.check(true).catch((error: unknown) => {
      current.logger.warn(
        'update',
        'APP_UPDATE_CHECK_FAILED',
        error instanceof Error ? error.message : String(error)
      );
    });
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
    // Cùng các bước có giới hạn thời gian như khi thoát thường: một bước treo không được chặn việc cài bản cập nhật.
    const trail = createShutdownTrail(activeContext.userData);
    trail('BẮT ĐẦU THOÁT để cài bản cập nhật');
    const report = await runShutdownSequence(buildShutdownSteps(activeContext, true), {
      totalTimeoutMs: SHUTDOWN_TOTAL_TIMEOUT_MS,
      trail
    });
    trail(`THOÁT XONG (cài bản cập nhật) sau ${report.totalMs} ms`);
    tray = null;
  };
  const current = new AppContext(prepareForAppUpdate);
  context = current;
  current.initialize();
  // Lưới an toàn cuối cùng: promise bị từ chối mà không ai bắt (ví dụ trong tác vụ nền) chỉ được ghi
  // nhật ký thay vì bật hộp thoại lỗi nghiêm trọng của Electron và làm gián đoạn tác vụ đang chạy.
  process.on('unhandledRejection', (reason: unknown) => {
    current.logger.error(
      'app',
      'UNHANDLED_REJECTION',
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    );
  });
  const startupTools = connectToolsAtStartup(current)
    .catch((error: unknown) => {
      current.logger.warn(
        'tools',
        'TOOLS_AUTO_CONNECT_FAILED',
        error instanceof Error ? error.message : String(error)
      );
    })
    // Chỉ khi chạy e2e từ mã nguồn (mặc định 0): mô phỏng kết nối công cụ lâu lúc mở app.
    .then(() => (e2eQueueStartDelayMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, e2eQueueStartDelayMs)) : undefined))
    .finally(() => {
      // Hàng đợi chỉ được khôi phục sau khi trạng thái công cụ đã được xác định.
      // Cổng canExecute trong QueueManager tiếp tục giữ tác vụ nếu công cụ bắt buộc vẫn thiếu.
      // start() giữ mọi tác vụ dở ở trạng thái tạm dừng và chờ người dùng chọn Tiếp tục (trừ khi bật tự tiếp tục).
      void current.queue.start().catch((error: unknown) => {
        current.logger.error(
          'queue',
          'QUEUE_START_FAILED',
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        );
      });
    });
  // Giao diện được mở ngay với dữ liệu local. Kiểm tra/sửa công cụ vẫn chạy
  // tự động ở nền; QueueManager chỉ khởi động sau khi ba công cụ bắt buộc đã
  // được xác định để không tạo trạng thái sẵn sàng giả.
  registerIpc(current);
  mainWindow = createMainWindow();
  wireWindow(mainWindow);
  // TUBMEDIA E2E FAKE UPDATE STATUS HOOK (2026-09-25): chỉ có tác dụng khi đặt CẢ HAI biến môi trường
  // e2e tường minh — không tồn tại trong bản phát hành thật. Cho bài kiểm thật mô phỏng ĐÚNG sự kiện
  // "vừa phát hiện bản cập nhật mới" (lúc khởi động hoặc kiểm tra định kỳ) mà không cần mạng thật/máy
  // chủ cập nhật thật — AppUpdateService/electron-updater hoàn toàn không bị đụng tới.
  if (isE2E && fakeUpdateStatusJson) {
    const fakeStatusJson = fakeUpdateStatusJson;
    const windowForFakeStatus = mainWindow;
    try {
      const fakeStatus = JSON.parse(fakeStatusJson) as AppUpdateStatus;
      // 'did-finish-load' chỉ báo trang HTML đã tải xong — KHÔNG đảm bảo React đã mount và
      // useDesktopEvents() đã đăng ký lắng nghe onUpdateStatus (sự kiện gửi quá sớm sẽ bị mất, không ai
      // nhận). Gửi LẶP LẠI trong vài giây đầu thay vì đúng 1 lần: renderer tự chống lặp thông báo theo
      // đúng state+version (xem claimUpdateNotice trong use-desktop-events.ts) nên gửi thêm vài lần
      // không gây hiện thông báo nhiều lần — chỉ đảm bảo CHẮC CHẮN có ít nhất một lượt gửi tới đúng lúc
      // renderer đã sẵn sàng nhận, không phụ thuộc vào thời điểm chính xác của 'did-finish-load'.
      let attemptsLeft = 20;
      const sendFakeStatus = (): void => {
        attemptsLeft -= 1;
        if (windowForFakeStatus.isDestroyed()) return;
        windowForFakeStatus.webContents.send(IPC.events.updateStatus, fakeStatus);
        if (attemptsLeft > 0) setTimeout(sendFakeStatus, 300);
      };
      windowForFakeStatus.webContents.once('did-finish-load', () => setTimeout(sendFakeStatus, 300));
    } catch (error) {
      console.error('TUBMEDIA_E2E_FAKE_UPDATE_STATUS_JSON không hợp lệ:', error);
    }
  }
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
      // Không thoát âm thầm: người dùng cần biết vì sao ứng dụng không mở được
      // (ví dụ cơ sở dữ liệu hỏng hoặc migration thất bại).
      dialog.showErrorBox(
        'Download video Tubmedia không thể khởi động',
        error instanceof Error ? error.message : String(error)
      );
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

  // Sau phát hành 1.6.0 (2026-10-06): bấm X mà app không thoát hẳn. Mỗi bước dọn dẹp giờ có giới hạn thời gian (bước
  // treo thì chuyển sang bước sau — bước giết tiến trình con vẫn chạy), tổng tối đa 15 giây, và mọi diễn biến ghi
  // đồng bộ ra logs\shutdown.log. Chốt chặn cuối: hẹn giờ độc lập buộc app.exit nếu cả chuỗi vẫn không trả về.
  const trail = createShutdownTrail(current.userData);
  trail(`BẮT ĐẦU THOÁT (chế độ ${shutdownMode}, ${current.queue.activeCount()} tác vụ hàng đợi đang chạy)`);
  const watchdog = setTimeout(() => {
    trail(`QUÁ ${SHUTDOWN_WATCHDOG_MS} ms mà chuỗi dọn dẹp chưa trả về — BUỘC THOÁT`);
    app.exit(0);
  }, SHUTDOWN_WATCHDOG_MS);

  void (async () => {
    try {
      const report = await runShutdownSequence(buildShutdownSteps(current, shutdownMode === 'preserve'), {
        totalTimeoutMs: SHUTDOWN_TOTAL_TIMEOUT_MS,
        trail
      });
      trail(`THOÁT XONG sau ${report.totalMs} ms${report.forced ? ' — buộc thoát vì quá giới hạn tổng' : ''}`);
    } catch (error) {
      trail(`LỖI ngoài dự kiến khi dọn dẹp: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(watchdog);
      app.exit(0);
    }
  })();
});
