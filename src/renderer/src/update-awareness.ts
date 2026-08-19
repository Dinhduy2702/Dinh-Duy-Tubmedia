type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

interface StartupUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  message: string | null;
  checkedAt: string | null;
}

interface TubmediaUpdateAwarenessApi {
  getState: () => Promise<unknown>;
  checkNow: () => Promise<unknown>;
  downloadNow: () => Promise<unknown>;
  installNow: () => Promise<unknown>;
  onState: (listener: (state: unknown) => void) => () => void;
}

declare global {
  interface Window {
    tubmediaUpdateAwareness?: TubmediaUpdateAwarenessApi;
  }
}

const TOAST_ID = 'tubmedia-update-awareness-toast';
const DOT_ATTRIBUTE = 'data-tubmedia-update-dot';
const UPDATE_AVAILABLE_AUTO_DISMISS_MS = 12_000;

let latestState: StartupUpdateState | null = null;
let observer: MutationObserver | null = null;
let availableDismissTimer: number | null = null;
let announcedVersion: string | null = null;

function isUpdateState(value: unknown): value is StartupUpdateState {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<StartupUpdateState>;
  return typeof candidate.status === 'string' && typeof candidate.currentVersion === 'string';
}

function hasVisibleUpdate(state: StartupUpdateState | null): boolean {
  return Boolean(
    state?.availableVersion && ['available', 'downloading', 'downloaded'].includes(state.status)
  );
}

function shouldShowToast(state: StartupUpdateState): boolean {
  return Boolean(state.availableVersion && ['available', 'downloading', 'downloaded'].includes(state.status));
}

function removeDots(): void {
  document.querySelectorAll(`[${DOT_ATTRIBUTE}]`).forEach((dot) => {
    dot.remove();
  });
}

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN');
}

function isUpdateMenuCandidate(element: Element): boolean {
  if (element.closest(`#${TOAST_ID}`)) return false;

  const text = normalizeLabel(element.textContent ?? '');
  if (!text || text.length > 42) return false;

  if (text === 'cập nhật' || text === 'cập nhật ứng dụng' || text === 'update') {
    return true;
  }

  return (
    text.includes('cập nhật') &&
    !text.includes('cập nhật ngay') &&
    !text.includes('đang cập nhật') &&
    !text.includes('kiểm tra cập nhật')
  );
}

function applyUpdateDots(): void {
  removeDots();

  if (!hasVisibleUpdate(latestState)) return;

  const candidates = document.querySelectorAll('button, a, [role="button"], [role="tab"], nav li');

  for (const element of candidates) {
    if (!isUpdateMenuCandidate(element)) continue;

    const htmlElement = element as HTMLElement;

    if (getComputedStyle(htmlElement).position === 'static') {
      htmlElement.style.position = 'relative';
    }

    const dot = document.createElement('span');
    dot.setAttribute(DOT_ATTRIBUTE, 'true');
    dot.setAttribute('aria-label', 'Có bản cập nhật mới');

    Object.assign(dot.style, {
      position: 'absolute',
      width: '9px',
      height: '9px',
      borderRadius: '9999px',
      background: '#ef4444',
      top: '5px',
      right: '5px',
      boxShadow: '0 0 0 2px rgba(255,255,255,0.95)',
      pointerEvents: 'none',
      zIndex: '30'
    });

    htmlElement.appendChild(dot);
  }
}

function clearAvailableDismissTimer(): void {
  if (availableDismissTimer === null) return;

  window.clearTimeout(availableDismissTimer);
  availableDismissTimer = null;
}

function hideToast(): void {
  clearAvailableDismissTimer();
  document.getElementById(TOAST_ID)?.remove();
}

function scheduleAvailableAutoDismiss(): void {
  clearAvailableDismissTimer();

  availableDismissTimer = window.setTimeout(() => {
    availableDismissTimer = null;
    document.getElementById(TOAST_ID)?.remove();
  }, UPDATE_AVAILABLE_AUTO_DISMISS_MS);
}

function buttonText(state: StartupUpdateState): string {
  switch (state.status) {
    case 'downloaded':
      return 'Cài đặt & khởi động lại';
    case 'downloading':
      return `Đang tải ${Math.round(state.progressPercent ?? 0)}%`;
    default:
      return 'Cập nhật ngay';
  }
}

function descriptionText(state: StartupUpdateState): string {
  switch (state.status) {
    case 'downloading':
      return `Đang tải Tubmedia ${state.availableVersion ?? ''}.`;
    case 'downloaded':
      return `Tubmedia ${state.availableVersion ?? ''} đã tải xong và sẵn sàng cài đặt.`;
    default:
      return `Bạn đang dùng ${state.currentVersion}. Phiên bản ${state.availableVersion ?? ''} đã sẵn sàng.`;
  }
}

function ensureToast(): HTMLDivElement {
  const existing = document.getElementById(TOAST_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const toast = document.createElement('div');
  toast.id = TOAST_ID;

  Object.assign(toast.style, {
    position: 'fixed',
    right: '20px',
    top: '20px',
    zIndex: '2147483000',
    width: 'min(390px, calc(100vw - 40px))',
    padding: '14px',
    borderRadius: '14px',
    background: 'rgba(18, 18, 20, 0.97)',
    color: '#ffffff',
    boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.12)',
    fontFamily: 'inherit'
  });

  document.body.appendChild(toast);
  return toast;
}

function renderToast(state: StartupUpdateState): void {
  // Startup checks, no-update results, network/feed failures and parser errors
  // must remain silent in the main workspace. Technical detail belongs in logs
  // and the dedicated Updates/Diagnostics surfaces.
  if (!shouldShowToast(state)) {
    hideToast();
    return;
  }

  const version = state.availableVersion;
  if (!version) {
    hideToast();
    return;
  }

  const existing = document.getElementById(TOAST_ID);

  // A confirmed version is announced once. Re-checking the same release must
  // not keep recreating a toast that the user already dismissed.
  if (state.status === 'available' && announcedVersion === version && !existing) {
    return;
  }

  const toast = ensureToast();
  toast.replaceChildren();

  const headingRow = document.createElement('div');
  Object.assign(headingRow.style, {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    justifyContent: 'space-between',
    marginBottom: '7px'
  });

  const title = document.createElement('div');
  title.textContent = `Có bản Tubmedia ${version}`;
  Object.assign(title.style, {
    fontSize: '16px',
    fontWeight: '700',
    lineHeight: '1.35'
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Đóng thông báo cập nhật');
  close.textContent = '×';
  Object.assign(close.style, {
    border: '0',
    background: 'transparent',
    color: '#ffffff',
    opacity: '0.68',
    fontSize: '21px',
    lineHeight: '1',
    padding: '0 2px',
    cursor: 'pointer',
    flex: '0 0 auto'
  });
  close.addEventListener('click', hideToast);

  headingRow.append(title, close);

  const description = document.createElement('div');
  description.textContent = descriptionText(state);
  Object.assign(description.style, {
    fontSize: '13px',
    lineHeight: '1.5',
    opacity: '0.88',
    marginBottom: '13px'
  });

  toast.append(headingRow, description);

  if (state.status === 'downloading') {
    const track = document.createElement('div');
    const bar = document.createElement('div');

    Object.assign(track.style, {
      width: '100%',
      height: '7px',
      borderRadius: '9999px',
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.14)',
      marginBottom: '12px'
    });

    Object.assign(bar.style, {
      width: `${Math.max(0, Math.min(100, state.progressPercent ?? 0))}%`,
      height: '100%',
      background: '#ffffff',
      transition: 'width 160ms ease'
    });

    track.appendChild(bar);
    toast.appendChild(track);
  }

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end'
  });

  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'Để sau';
  Object.assign(later.style, {
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'transparent',
    color: '#ffffff',
    padding: '8px 12px',
    borderRadius: '9px',
    cursor: 'pointer'
  });
  later.addEventListener('click', hideToast);
  actions.appendChild(later);

  const primary = document.createElement('button');
  primary.type = 'button';
  primary.textContent = buttonText(state);
  primary.disabled = state.status === 'downloading';

  Object.assign(primary.style, {
    border: '0',
    background: '#ffffff',
    color: '#111111',
    padding: '8px 12px',
    borderRadius: '9px',
    fontWeight: '700',
    cursor: primary.disabled ? 'default' : 'pointer',
    opacity: primary.disabled ? '0.72' : '1'
  });

  primary.addEventListener('click', () => {
    const api = window.tubmediaUpdateAwareness;
    if (!api) return;

    clearAvailableDismissTimer();

    if (state.status === 'downloaded') {
      void api.installNow();
      return;
    }

    void api.downloadNow();
  });

  actions.appendChild(primary);
  toast.appendChild(actions);

  if (state.status === 'available') {
    announcedVersion = version;
    scheduleAvailableAutoDismiss();
  } else {
    clearAvailableDismissTimer();
  }
}

function renderState(state: StartupUpdateState): void {
  latestState = state;
  applyUpdateDots();
  renderToast(state);
}

function startMutationObserver(): void {
  if (observer) return;

  observer = new MutationObserver(() => {
    applyUpdateDots();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true
  });
}

async function initialize(): Promise<void> {
  const api = window.tubmediaUpdateAwareness;
  if (!api) return;

  startMutationObserver();

  api.onState((value) => {
    if (isUpdateState(value)) {
      renderState(value);
    }
  });

  const current = await api.getState();
  if (isUpdateState(current)) {
    renderState(current);
  }

  // The main process owns the automatic startup and six-hour update checks.
  // The renderer only observes state and reacts to explicit user actions.
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      void initialize();
    },
    { once: true }
  );
} else {
  void initialize();
}

export {};
