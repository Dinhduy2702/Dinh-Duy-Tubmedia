import { useEffect, useState, type ChangeEvent, type MouseEvent } from 'react';
import {
  CheckCircle2,
  ClipboardPaste,
  Cookie,
  FileText,
  Globe,
  LoaderCircle,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react';
import type { BrowserProfileOption, CookieConfigurationStatus } from '@shared/types/domain';
import { COOKIE_BLOCKING_CODES } from '@shared/utils/cookie-policy';
import { useAppStore } from '../stores/app-store';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfigured?: () => Promise<void> | void;
}

type Tab = 'browser' | 'paste' | 'file';
type BrowserName = 'chrome' | 'edge' | 'firefox';
const MANUAL_PROFILE_OPTION = '__manual__';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CookieManagerDialog({ open, onClose, onConfigured }: Props): React.JSX.Element | null {
  const setSettings = useAppStore((state) => state.setSettings);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const dismissAttentionByCodes = useAppStore((state) => state.dismissAttentionByCodes);
  const refreshJobs = useAppStore((state) => state.refreshJobs);
  const [tab, setTab] = useState<Tab>('browser');
  const [browser, setBrowser] = useState<BrowserName>('firefox');
  const [profile, setProfile] = useState('');
  const [profiles, setProfiles] = useState<BrowserProfileOption[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<CookieConfigurationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void window.desktop.cookies
      .status()
      .then((next) => {
        setStatus(next);
        if (next.browser !== 'none') {
          setBrowser(next.browser);
          setProfile(next.browserProfile);
        }
      })
      .catch((error: unknown) => setError(messageOf(error)));
  }, [open, setError]);

  // Sự cố 2026-09-25: máy có nhiều hồ sơ Chrome thì để trống ô hồ sơ sẽ âm thầm lấy nhầm "hồ sơ dùng
  // gần nhất trong Chrome" (yt-dlp tự chọn), không phải hồ sơ người dùng nghĩ tới. Liệt kê hồ sơ THẬT
  // (đọc Local State) để người dùng chọn đúng theo tên tài khoản thay vì gõ tay tên thư mục kỹ thuật.
  useEffect(() => {
    if (!open || tab !== 'browser') return;
    let cancelled = false;
    void window.desktop.cookies
      .listBrowserProfiles(browser)
      .then((list) => {
        if (cancelled) return;
        setProfiles(list);
        setProfile((current) => (current || !list.length ? current : (list[0]?.id ?? current)));
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, browser]);

  if (!open) return null;

  const isManualProfile = profiles.length === 0 || !profiles.some((item) => item.id === profile);
  const selectedProfileLabel = profiles.find((item) => item.id === profile)?.label ?? '';

  const finish = async (next: CookieConfigurationStatus, detail?: string): Promise<void> => {
    setStatus(next);
    setSettings(await window.desktop.settings.get());
    setError(null);
    dismissAttentionByCodes(COOKIE_BLOCKING_CODES);
    try {
      await refreshJobs();
      await onConfigured?.();
      setAttention({
        id: `cookies-updated-${Date.now()}`,
        severity: 'success',
        title: 'Cookies đã được cập nhật',
        message: detail
          ? `${detail} Các video bị chặn đã tự nhận cookies mới và tiếp tục; không cần dừng danh sách hoặc bấm tải lại.`
          : 'Các video bị chặn đã tự nhận cookies mới và tiếp tục; không cần dừng danh sách hoặc bấm tải lại.',
        sticky: false
      });
    } finally {
      onClose();
    }
  };

  const applyBrowserCookies = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.desktop.cookies.useBrowser(browser, profile);
      const detail = selectedProfileLabel ? `Đã dùng hồ sơ/tài khoản: ${selectedProfileLabel}.` : undefined;
      await finish(next, detail);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const savePasted = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.desktop.cookies.saveText(text);
      setText('');
      await finish(next);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (): Promise<void> => {
    setBusy(true);
    try {
      const path = await window.desktop.dialogs.chooseCookiesFile();
      if (!path) return;
      const next = await window.desktop.cookies.useFile(path);
      await finish(next);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.desktop.cookies.clear();
      setStatus(next);
      setSettings(await window.desktop.settings.get());
      setError(null);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-overlay cookie-dialog-overlay"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="dialog-content cookie-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quản lý cookies"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xl font-black">
              <Cookie size={23} style={{ color: 'var(--accent)' }} />
              Cookies và đăng nhập
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              Chọn đúng một trong ba cách. Cookies chỉ được truyền cho yt-dlp ở bộ phận tải nền và luôn bị che
              khỏi nhật ký.
            </p>
          </div>
          <button className="btn btn-ghost p-2" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="cookie-status mt-4">
          {status?.mode === 'none' ? (
            <ShieldAlert size={18} style={{ color: 'var(--warn)' }} />
          ) : (
            <CheckCircle2 size={18} style={{ color: 'var(--good)' }} />
          )}
          <div>
            <b>{status?.label ?? 'Đang đọc trạng thái...'}</b>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Chế độ hiện tại:{' '}
              {status?.mode === 'browser'
                ? 'Lấy từ trình duyệt'
                : status?.mode === 'file'
                  ? 'Dùng tệp cookies.txt'
                  : status?.mode === 'pasted'
                    ? 'Cookies dán trực tiếp'
                    : 'Chưa cấu hình'}
            </div>
          </div>
          {status?.mode !== 'none' && (
            <button
              className="btn ml-auto px-2.5 py-1.5 text-xs"
              disabled={busy}
              onClick={() => void clear()}
            >
              <Trash2 size={14} />
              Xóa cookies
            </button>
          )}
        </div>

        <div className="cookie-tabs mt-5">
          <button className={tab === 'browser' ? 'active' : ''} onClick={() => setTab('browser')}>
            <Globe size={17} />
            Lấy từ trình duyệt
          </button>
          <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>
            <ClipboardPaste size={17} />
            Dán trực tiếp
          </button>
          <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
            <FileText size={17} />
            Chọn tệp TXT
          </button>
        </div>

        {tab === 'browser' && (
          <div className="cookie-panel">
            <div className="grid gap-4 md:grid-cols-2">
              <label>
                <span className="label">Trình duyệt</span>
                <select
                  className="select"
                  aria-label="Trình duyệt"
                  value={browser}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setBrowser(event.target.value as BrowserName)
                  }
                >
                  <option value="firefox">Firefox — khuyến nghị trên Windows</option>
                  <option value="chrome">Chrome</option>
                  <option value="edge">Microsoft Edge</option>
                </select>
              </label>
              <label>
                <span className="label">Hồ sơ trình duyệt</span>
                {profiles.length > 0 ? (
                  <select
                    className="select"
                    aria-label="Hồ sơ trình duyệt"
                    value={isManualProfile ? MANUAL_PROFILE_OPTION : profile}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                      const value = event.target.value;
                      setProfile(value === MANUAL_PROFILE_OPTION ? '' : value);
                    }}
                  >
                    {profiles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                        {item.isLastUsed ? ' — đang dùng gần nhất trong Chrome' : ''}
                      </option>
                    ))}
                    <option value={MANUAL_PROFILE_OPTION}>Khác — tự nhập tên hồ sơ</option>
                  </select>
                ) : (
                  <input
                    className="input"
                    value={profile}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setProfile(event.target.value)}
                    placeholder="Mặc định hoặc Hồ sơ 1"
                  />
                )}
                {isManualProfile && profiles.length > 0 && (
                  <input
                    className="input mt-2"
                    value={profile}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setProfile(event.target.value)}
                    placeholder="Tên thư mục hồ sơ, vd Profile 1"
                  />
                )}
              </label>
            </div>
            {selectedProfileLabel && (
              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                Sẽ lấy cookies của: <b>{selectedProfileLabel}</b>
              </p>
            )}
            <div className="cookie-warning mt-4">
              <ShieldAlert size={18} />
              <div>
                <b>Lưu ý cho Chrome/Edge trên Windows</b>
                <p>
                  Hãy đóng hoàn toàn trình duyệt và tiến trình chạy nền trước khi tải. Nếu cơ sở dữ liệu vẫn
                  bị khóa, dùng Firefox, Dán trực tiếp hoặc Chọn tệp TXT.
                </p>
              </div>
            </div>
            <button
              className="btn btn-primary mt-4"
              disabled={busy}
              onClick={() => void applyBrowserCookies()}
            >
              {busy ? <LoaderCircle className="animate-spin" size={17} /> : <Globe size={17} />}Dùng trình
              duyệt này
            </button>
          </div>
        )}

        {tab === 'paste' && (
          <div className="cookie-panel">
            <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>
              Có thể dán Netscape cookies.txt, JSON xuất từ trình duyệt hoặc chuỗi Cookie dạng name=value;
              name2=value2. Ứng dụng tự chuyển đổi và không hiển thị lại nội dung.
            </p>
            <textarea
              className="textarea cookie-textarea font-mono text-xs"
              value={text}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
              placeholder={
                '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\tNAME\tVALUE\n\nhoặc: name=value; name2=value2'
              }
            />
            <button
              className="btn btn-primary mt-4"
              disabled={busy || !text.trim()}
              onClick={() => void savePasted()}
            >
              {busy ? <LoaderCircle className="animate-spin" size={17} /> : <ClipboardPaste size={17} />}Kiểm
              tra và lưu cookies
            </button>
          </div>
        )}

        {tab === 'file' && (
          <div className="cookie-panel">
            <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>
              Chọn tệp cookies.txt dạng Netscape hoặc tệp JSON đã xuất từ trình duyệt. Ứng dụng kiểm tra và
              chuyển đổi an toàn trước khi sử dụng.
            </p>
            <button className="btn btn-primary mt-4" disabled={busy} onClick={() => void chooseFile()}>
              {busy ? <LoaderCircle className="animate-spin" size={17} /> : <FileText size={17} />}Chọn tệp
              cookies
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
