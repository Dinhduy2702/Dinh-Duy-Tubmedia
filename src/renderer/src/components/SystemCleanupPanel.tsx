import { AlertTriangle, CheckCircle2, HardDrive, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { safeUiText } from '../utils/ui-error';
import { showNotice } from '../utils/notify';
import { progressFillStyle } from '../utils/progress-style';
import { ConfirmDialog } from './ConfirmDialog';
import {
  QUARANTINE_RETENTION_DAYS,
  SYSTEM_CLEANUP_ADMIN_INFO_ITEMS,
  SYSTEM_CLEANUP_CATEGORIES,
  type QuarantineEntry,
  type SystemCleanupCategoryId,
  type SystemCleanupFindingClassification,
  type SystemCleanupStatus
} from '@shared/system-cleanup';

type SafetyTone = 'very-safe' | 'safe' | 'caution';

interface SafetyMeta {
  label: string;
  description: string;
  tone: SafetyTone;
}

interface NeedMeta {
  label: string;
  description: string;
  tone: 'low' | 'medium' | 'high' | 'urgent';
}

const terminalPhases = new Set(['completed', 'cancelled', 'failed']);

const SAFETY_META: Record<SystemCleanupCategoryId, SafetyMeta> = {
  userTemp: {
    label: 'Rất an toàn',
    description: 'Chỉ xóa tệp tạm; ứng dụng có thể tạo lại khi cần.',
    tone: 'very-safe'
  },
  thumbnailCache: {
    label: 'Rất an toàn',
    description: 'Windows tự tạo lại hình thu nhỏ và icon cache.',
    tone: 'very-safe'
  },
  crashReports: {
    label: 'An toàn',
    description: 'Chỉ xóa báo cáo lỗi cũ của riêng bạn, không xóa ứng dụng.',
    tone: 'safe'
  },
  browserCache: {
    label: 'Rất an toàn',
    description: 'Không xóa mật khẩu, bookmark, cookie đăng nhập hoặc lịch sử.',
    tone: 'very-safe'
  },
  capcutCache: {
    label: 'An toàn',
    description: 'Chỉ dọn Cache, Temp, Logs và Crashpad đã cho phép.',
    tone: 'safe'
  },
  zaloCache: {
    label: 'An toàn',
    description: 'Không đụng tới Zalo Received Files hoặc dữ liệu trò chuyện.',
    tone: 'safe'
  },
  tubmediaResidue: {
    label: 'An toàn có kiểm soát',
    description:
      'Chỉ nhận diện phần tải dở và clip/thư mục tạm có dấu nhận diện Tubmedia, không đụng thành phẩm; dữ liệu tiếp tục tải quá 7 ngày sẽ mất.',
    tone: 'caution'
  }
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);

  return `${(value / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

function needMeta(bytes: number): NeedMeta {
  if (bytes >= 5 * 1024 ** 3) {
    return {
      label: 'Rất nên dọn',
      description: 'Dung lượng rác đang chiếm rất nhiều không gian lưu trữ.',
      tone: 'urgent'
    };
  }

  if (bytes >= 1024 ** 3) {
    return {
      label: 'Nên dọn sớm',
      description: 'Có thể giải phóng từ 1 GB trở lên.',
      tone: 'high'
    };
  }

  if (bytes >= 250 * 1024 ** 2) {
    return {
      label: 'Nên dọn',
      description: 'Dung lượng đủ lớn để việc dọn dẹp có ý nghĩa.',
      tone: 'medium'
    };
  }

  if (bytes >= 50 * 1024 ** 2) {
    return {
      label: 'Có thể dọn',
      description: 'Có một lượng cache hoặc tệp tạm có thể giải phóng.',
      tone: 'medium'
    };
  }

  return {
    label: bytes > 0 ? 'Chưa cần' : 'Chờ quét',
    description: bytes > 0 ? 'Dung lượng nhỏ, không cần ưu tiên xóa.' : 'Quét để đánh giá dung lượng.',
    tone: 'low'
  };
}

function scanKey(categories: readonly SystemCleanupCategoryId[]): string {
  return [...categories].sort().join(',');
}

function cleanupStatusMessage(status: SystemCleanupStatus): string {
  const category = SYSTEM_CLEANUP_CATEGORIES.find((item) => status.message.includes(item.id));
  const verb = status.mode === 'clean' ? 'dọn' : 'quét';

  if (!terminalPhases.has(status.phase)) {
    return category ? `Đang ${verb}: ${category.label}` : `Đang ${verb}...`;
  }

  if (status.phase === 'completed') {
    return status.mode === 'clean' ? 'Dọn dẹp hoàn tất' : 'Quét dung lượng hoàn tất';
  }

  if (status.phase === 'cancelled') {
    return 'Đã dừng theo yêu cầu';
  }

  return status.phase === 'failed' ? `${status.mode === 'clean' ? 'Dọn dẹp' : 'Quét'} không hoàn tất` : status.message;
}

const FINDING_META: Record<SystemCleanupFindingClassification, { title: string; description: string }> = {
  'safe-to-delete': {
    title: 'Có thể xóa bằng Tubmedia',
    description: 'Chỉ các mục thuộc allowlist mới được đưa vào lệnh dọn — chuyển vào khu cách ly, có thể hoàn tác.'
  },
  review: {
    title: 'Cần người dùng xem lại',
    description: 'Tubmedia chỉ báo cáo và không tự xóa các file này.'
  },
  protected: {
    title: 'Dữ liệu được bảo vệ',
    description: 'Tubmedia khóa xóa vì đây có thể là dữ liệu Windows hoặc chương trình.'
  }
};

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function SystemCleanupPanel(): React.JSX.Element {
  const defaultSelection = useMemo(
    () => SYSTEM_CLEANUP_CATEGORIES.filter((item) => item.defaultSelected).map((item) => item.id),
    []
  );
  const [selected, setSelected] = useState<SystemCleanupCategoryId[]>(defaultSelection);
  const [status, setStatus] = useState<SystemCleanupStatus | null>(null);
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null);
  const [lastScannedKey, setLastScannedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [quarantineEntries, setQuarantineEntries] = useState<QuarantineEntry[]>([]);
  const [quarantineSelected, setQuarantineSelected] = useState<Set<string>>(new Set());
  const [quarantineBusy, setQuarantineBusy] = useState(false);

  const running = Boolean(status && !terminalPhases.has(status.phase));
  const currentScanKey = scanKey(selected);

  const resultById = new Map(status?.results.map((result) => [result.id, result]) ?? []);
  const selectedEstimatedBytes = selected.reduce(
    (total, id) => total + (resultById.get(id)?.estimatedBytes ?? 0),
    0
  );
  const overallNeed = needMeta(selectedEstimatedBytes);
  const scannedUpToDate =
    !running && lastScannedKey === currentScanKey && status?.mode === 'estimate' && status.phase === 'completed';
  const canClean = scannedUpToDate && selectedEstimatedBytes > 0;

  async function loadQuarantine(): Promise<void> {
    try {
      const entries = await window.desktop.systemCleanup.quarantineList();
      setQuarantineEntries(entries);
    } catch (loadError) {
      setError(safeUiText(loadError, 'Không đọc được danh sách đã cách ly.'));
    }
  }

  useEffect(() => {
    void loadQuarantine();
  }, []);

  useEffect(() => {
    if (!status || terminalPhases.has(status.phase)) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const next = await window.desktop.systemCleanup.status(status.runId);

        if (next) {
          setStatus(next);
        }
      } catch (pollError) {
        setError(safeUiText(pollError, 'Không đọc được tiến trình.'));
      }
    }, 600);

    return () => window.clearInterval(timer);
  }, [status?.runId, status?.phase]);

  useEffect(() => {
    if (status?.phase === 'completed' && status.mode === 'estimate' && activeRequestKey) {
      setLastScannedKey(activeRequestKey);
    }

    if (status?.phase === 'completed' && status.mode === 'clean') {
      setLastScannedKey(null);
      void loadQuarantine();
    }
  }, [activeRequestKey, status?.mode, status?.phase]);

  function toggleCategory(id: SystemCleanupCategoryId): void {
    if (running) {
      return;
    }

    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
    setError(null);
  }

  async function startScan(): Promise<void> {
    setError(null);

    if (selected.length === 0) {
      showNotice('warning', 'Chưa chọn hạng mục nào', 'Hãy chọn ít nhất một hạng mục rồi thử lại.');
      return;
    }

    const requestKey = scanKey(selected);

    try {
      setActiveRequestKey(requestKey);

      const next = await window.desktop.systemCleanup.start({ mode: 'estimate', categories: selected });

      setStatus(next);
    } catch (startError) {
      setError(safeUiText(startError, 'Không thể bắt đầu quét.'));
    }
  }

  async function confirmClean(): Promise<void> {
    setCleaning(true);
    setError(null);

    try {
      const next = await window.desktop.systemCleanup.start({ mode: 'clean', categories: selected });
      setStatus(next);
      setConfirmOpen(false);
    } catch (cleanError) {
      setError(safeUiText(cleanError, 'Không thể bắt đầu dọn dẹp.'));
    } finally {
      setCleaning(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!status) {
      return;
    }

    try {
      const next = await window.desktop.systemCleanup.cancel(status.runId);

      if (next) {
        setStatus(next);
      }
    } catch (cancelError) {
      setError(safeUiText(cancelError, 'Không gửi được yêu cầu dừng.'));
    }
  }

  async function openStorageSettings(): Promise<void> {
    try {
      await window.desktop.systemCleanup.openStorageSettings();
    } catch (openError) {
      setError(safeUiText(openError, 'Không mở được công cụ Dọn dẹp ổ đĩa của Windows.'));
    }
  }

  function toggleQuarantineSelected(id: string): void {
    setQuarantineSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function restoreQuarantine(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    setQuarantineBusy(true);
    setError(null);

    try {
      const outcomes = await window.desktop.systemCleanup.quarantineRestore(ids);
      const restored = outcomes.filter((item) => item.ok).length;
      const failed = outcomes.length - restored;

      if (restored > 0) {
        showNotice(
          'success',
          `Đã hoàn tác ${restored} mục`,
          failed > 0 ? `${failed} mục không hoàn tác được — xem chi tiết bên dưới.` : 'File đã trở lại đúng vị trí gốc.'
        );
      } else {
        showNotice('warning', 'Không hoàn tác được mục nào', 'Xem chi tiết bên dưới để biết lý do.');
      }

      setQuarantineSelected(new Set());
      await loadQuarantine();
    } catch (restoreError) {
      setError(safeUiText(restoreError, 'Không thể hoàn tác.'));
    } finally {
      setQuarantineBusy(false);
    }
  }

  const confirmDetails = selected
    .map((id) => {
      const result = resultById.get(id);
      if (!result || result.matchedItems === 0) return null;
      const category = SYSTEM_CLEANUP_CATEGORIES.find((item) => item.id === id);
      return `${category?.label ?? id}: ${result.matchedItems.toLocaleString('vi-VN')} tệp, ${formatBytes(result.estimatedBytes)}`;
    })
    .filter((line): line is string => line !== null);

  return (
    <section className="card system-cleanup-panel" data-testid="system-cleanup-panel">
      <div className="system-cleanup-heading">
        <div>
          <span className="system-cleanup-eyebrow">DỌN FILE RÁC CÓ KIỂM SOÁT</span>
          <h2>Quét dung lượng, xem độ an toàn rồi mới xóa</h2>
          <p>
            Tubmedia phân loại từng vùng dữ liệu, ước tính dung lượng và khóa nút xóa cho đến khi hoàn
            tất một lần quét đúng với lựa chọn hiện tại. Xóa thật đi qua khu cách ly riêng — có thể hoàn
            tác trong {QUARANTINE_RETENTION_DAYS} ngày trước khi bị dọn vĩnh viễn.
          </p>
        </div>

        <div className="system-cleanup-admin-badge">Tài khoản hiện tại • không cần quyền quản trị</div>
      </div>

      <div className="cleanup-summary-grid" aria-label="Tóm tắt dọn dẹp">
        <article>
          <span className="cleanup-summary-icon">
            <HardDrive size={18} />
          </span>
          <div>
            <small>Dung lượng tìm thấy</small>
            <strong>{formatBytes(selectedEstimatedBytes)}</strong>
          </div>
        </article>

        <article className={`need-${overallNeed.tone}`}>
          <span className="cleanup-summary-icon">
            <Sparkles size={18} />
          </span>
          <div>
            <small>Mức độ cần dọn</small>
            <strong>{overallNeed.label}</strong>
            <em>{overallNeed.description}</em>
          </div>
        </article>

        <article>
          <span className="cleanup-summary-icon">
            <ShieldCheck size={18} />
          </span>
          <div>
            <small>Quy tắc an toàn</small>
            <strong>Chỉ dọn trong tài khoản hiện tại</strong>
            <em>Không đụng Windows Temp, Windows Update hay các khu vực cần quyền quản trị.</em>
          </div>
        </article>

        <article>
          <span className="cleanup-summary-icon">
            {canClean ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div>
            <small>Trạng thái xóa</small>
            <strong>{canClean ? 'Đã quét • Có thể dọn' : 'Phải quét trước'}</strong>
            <em>{canClean ? 'Lựa chọn hiện tại đã được thống kê.' : 'Nút xóa đang được khóa an toàn.'}</em>
          </div>
        </article>
      </div>

      <div className="cleanup-safety-guide">
        <span className="safety-very-safe">Rất an toàn: cache và tệp tạm có thể tạo lại</span>
        <span className="safety-safe">An toàn: dữ liệu chẩn đoán hoặc cache cho phép</span>
        <span className="safety-caution">An toàn có kiểm soát: chỉ dữ liệu có dấu nhận diện Tubmedia</span>
      </div>

      <div className="system-cleanup-warning">
        Không quét Desktop, Documents, Downloads, Pictures, Videos, Zalo Received Files, thư mục gốc
        CapCut/Zalo, dữ liệu dự án Tubmedia hay bất kỳ thư mục hệ thống nào. Hãy đóng Chrome, Edge, CapCut
        và Zalo để dọn được nhiều hơn.
      </div>

      <div className="system-cleanup-group">
        <div className="system-cleanup-group-title">Dọn dẹp trong tài khoản hiện tại</div>

        <div className="system-cleanup-grid">
          {SYSTEM_CLEANUP_CATEGORIES.map((item) => {
            const checked = selected.includes(item.id);
            const result = resultById.get(item.id);
            const safety = SAFETY_META[item.id];
            const need = needMeta(result?.estimatedBytes ?? 0);

            return (
              <label className={`system-cleanup-option ${checked ? 'is-selected' : ''}`} key={item.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={running}
                  onChange={() => toggleCategory(item.id)}
                />

                <span className="system-cleanup-option-copy">
                  <span className="cleanup-option-title">
                    <strong>{item.label}</strong>
                    <b>{formatBytes(result?.estimatedBytes ?? 0)}</b>
                  </span>
                  <small>{item.description}</small>

                  <span className="system-cleanup-tags">
                    <em className={`safety-${safety.tone}`} title={safety.description}>
                      {safety.label}
                    </em>
                    <em className={`need-${need.tone}`} title={need.description}>
                      {need.label}
                    </em>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="system-cleanup-admin-info">
        <div className="system-cleanup-group-title">Cần quyền quản trị — Tubmedia không tự chạy</div>
        <p>
          Các mục dưới đây thuộc khu vực hệ thống dùng chung cho mọi tài khoản trên máy. Tubmedia không
          còn tự yêu cầu quyền quản trị để xóa nữa — hãy dùng công cụ Dọn dẹp ổ đĩa của chính Windows.
        </p>

        <ul className="system-cleanup-admin-list">
          {SYSTEM_CLEANUP_ADMIN_INFO_ITEMS.map((item) => (
            <li key={item.id}>
              <b>{item.label}</b>
              <small>{item.description}</small>
            </li>
          ))}
        </ul>

        <button type="button" className="system-cleanup-button secondary" onClick={() => void openStorageSettings()}>
          Mở Dọn dẹp ổ đĩa Windows
        </button>
      </div>

      {error && <div className="system-cleanup-error">{error}</div>}

      {status && (
        <div className="system-cleanup-progress-card">
          <div className="system-cleanup-progress-head">
            <strong>{cleanupStatusMessage(status)}</strong>
            <span>{Math.max(0, Math.min(100, status.progress))}%</span>
          </div>

          <div className="system-cleanup-progress-track">
            <span style={progressFillStyle(status.progress)} />
          </div>

          <div className="system-cleanup-stats">
            <span>
              <small>Ước tính</small>
              <b>{formatBytes(status.estimatedBytes)}</b>
            </span>
            <span>
              <small>Đã giải phóng</small>
              <b>{formatBytes(status.removedBytes)}</b>
            </span>
            <span>
              <small>Đã xử lý</small>
              <b>{status.removedItems.toLocaleString('vi-VN')} mục</b>
            </span>
            <span>
              <small>Bỏ qua / bị khóa</small>
              <b>{status.skippedItems.toLocaleString('vi-VN')} mục</b>
            </span>
          </div>

          {status.mode === 'estimate' && (
            <div className="cleanup-classification-stats" aria-label="Phân loại dữ liệu đã quét">
              <span className="is-safe">
                <small>Có thể dọn</small>
                <b>{formatBytes(status.safeToDeleteBytes ?? status.estimatedBytes)}</b>
              </span>
              <span className="is-review">
                <small>Cần xem lại • không tự xóa</small>
                <b>{formatBytes(status.reviewBytes ?? 0)}</b>
              </span>
              <span className="is-protected">
                <small>Được bảo vệ • khóa xóa</small>
                <b>{formatBytes(status.protectedBytes ?? 0)}</b>
              </span>
            </div>
          )}

          {status.driveBefore && (
            <div className="cleanup-drive-comparison">
              <span>
                Trống trước khi dọn: <b>{formatBytes(status.driveBefore.freeBytes)}</b>
              </span>
              <span>
                Trống sau khi dọn:{' '}
                <b>{status.driveAfter ? formatBytes(status.driveAfter.freeBytes) : 'Chưa hoàn tất'}</b>
              </span>
            </div>
          )}

          {status.results.length > 0 && (
            <details className="system-cleanup-errors">
              <summary>Chi tiết dung lượng theo từng hạng mục</summary>
              <ul>
                {status.results.map((result) => {
                  const category = SYSTEM_CLEANUP_CATEGORIES.find((item) => item.id === result.id);
                  return (
                    <li key={result.id}>
                      <b>{category?.label ?? 'Hạng mục'}:</b> {result.matchedItems.toLocaleString('vi-VN')} tệp,
                      ước tính {formatBytes(result.estimatedBytes)}
                      {status.mode === 'clean' &&
                        `, đã dọn ${formatBytes(result.removedBytes)}, bỏ qua ${result.skippedItems} mục`}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          {status.findings?.length > 0 && (
            <div className="cleanup-findings" aria-label="Danh sách dữ liệu được phân loại">
              {(['safe-to-delete', 'review', 'protected'] as const).map((classification) => {
                const findings = status.findings.filter(
                  (finding) => finding.classification === classification
                );
                if (findings.length === 0) return null;
                const meta = FINDING_META[classification];

                return (
                  <details className={`cleanup-finding-group is-${classification}`} key={classification}>
                    <summary>
                      <span>
                        <b>{meta.title}</b>
                        <small>{meta.description}</small>
                      </span>
                      <strong>{findings.length} mục</strong>
                    </summary>
                    <ul>
                      {findings.map((finding, index) => (
                        <li key={`${classification}:${finding.path}:${index}`}>
                          <div>
                            <b title={finding.path}>{finding.path}</b>
                            <span>{formatBytes(finding.bytes)}</span>
                          </div>
                          <small>{finding.reason}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          )}

          {status.errors.length > 0 && (
            <details className="system-cleanup-errors">
              <summary>{status.errors.length} mục chưa thể xử lý</summary>
              <ul>
                {status.errors.map((item) => (
                  <li key={item}>
                    {safeUiText(item, 'Một mục đang được Windows sử dụng nên đã được bỏ qua.')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="system-cleanup-actions">
        <button
          type="button"
          className="system-cleanup-button secondary"
          disabled={running || selected.length === 0}
          onClick={() => void startScan()}
        >
          Quét mục đã chọn
        </button>

        <button
          type="button"
          className="system-cleanup-button primary"
          disabled={!canClean}
          title={
            canClean
              ? 'Chỉ xóa các file thuộc allowlist đã quét — chuyển vào khu cách ly, có thể hoàn tác.'
              : 'Phải quét đúng lựa chọn hiện tại trước khi xóa.'
          }
          onClick={() => setConfirmOpen(true)}
        >
          Dọn dẹp và xóa file đã chọn
        </button>

        {running && (
          <button type="button" className="system-cleanup-button danger" onClick={() => void cancel()}>
            Yêu cầu dừng
          </button>
        )}
      </div>

      {!canClean && !running && (
        <p className="cleanup-action-note">
          Nút xóa được khóa cho đến khi quét xong đúng lựa chọn.
        </p>
      )}

      {quarantineEntries.length > 0 && (
        <div className="system-cleanup-quarantine">
          <div className="system-cleanup-group-title">
            Đã cách ly gần đây ({quarantineEntries.length} mục — tự xóa vĩnh viễn sau {QUARANTINE_RETENTION_DAYS}{' '}
            ngày nếu không hoàn tác)
          </div>

          <ul className="system-cleanup-quarantine-list">
            {quarantineEntries.map((entry) => (
              <li key={entry.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={quarantineSelected.has(entry.id)}
                    disabled={quarantineBusy}
                    onChange={() => toggleQuarantineSelected(entry.id)}
                  />
                  <span>
                    <b title={entry.originalPath}>{entry.originalPath}</b>
                    <small>
                      {formatBytes(entry.bytes)} • còn {daysLeft(entry.expiresAt)} ngày để hoàn tác
                    </small>
                  </span>
                </label>
                <button
                  type="button"
                  className="system-cleanup-button secondary"
                  disabled={quarantineBusy}
                  onClick={() => void restoreQuarantine([entry.id])}
                >
                  <RotateCcw size={14} /> Hoàn tác
                </button>
              </li>
            ))}
          </ul>

          <div className="system-cleanup-quarantine-actions">
            <button
              type="button"
              className="system-cleanup-button secondary"
              disabled={quarantineBusy || quarantineSelected.size === 0}
              onClick={() => void restoreQuarantine([...quarantineSelected])}
            >
              Hoàn tác đã chọn ({quarantineSelected.size})
            </button>
            <button
              type="button"
              className="system-cleanup-button secondary"
              disabled={quarantineBusy}
              onClick={() => void restoreQuarantine(quarantineEntries.map((entry) => entry.id))}
            >
              Hoàn tác tất cả
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Xóa các file đã chọn?"
        message={`Tubmedia sẽ chuyển ${formatBytes(selectedEstimatedBytes)} vào khu cách ly riêng — không xóa vĩnh viễn ngay. Bạn có thể hoàn tác trong ${QUARANTINE_RETENTION_DAYS} ngày.`}
        details={confirmDetails}
        confirmLabel={`Xóa ${formatBytes(selectedEstimatedBytes)}`}
        danger
        busy={cleaning}
        onConfirm={() => void confirmClean()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
