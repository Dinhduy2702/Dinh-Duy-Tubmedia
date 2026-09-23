import { AlertTriangle, CheckCircle2, HardDrive, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { safeUiText } from '../utils/ui-error';
import { showNotice } from '../utils/notify';
import { progressFillStyle } from '../utils/progress-style';
import {
  SYSTEM_CLEANUP_ADMIN_INFO_ITEMS,
  SYSTEM_CLEANUP_CATEGORIES,
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

  if (!terminalPhases.has(status.phase)) {
    return category ? `Đang quét: ${category.label}` : 'Đang quét và tính dung lượng...';
  }

  if (status.phase === 'completed') {
    return 'Quét dung lượng hoàn tất';
  }

  if (status.phase === 'cancelled') {
    return 'Đã dừng theo yêu cầu';
  }

  return status.phase === 'failed' ? 'Quét không hoàn tất' : status.message;
}

const FINDING_META: Record<SystemCleanupFindingClassification, { title: string; description: string }> = {
  'safe-to-delete': {
    title: 'Có thể xóa bằng Tubmedia',
    description: 'Chỉ các mục thuộc allowlist mới được đưa vào lệnh dọn (khi Giai đoạn 4b mở khóa xóa).'
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
        setError(safeUiText(pollError, 'Không đọc được tiến trình quét dọn dẹp.'));
      }
    }, 600);

    return () => window.clearInterval(timer);
  }, [status?.runId, status?.phase]);

  useEffect(() => {
    if (status?.phase === 'completed' && status.mode === 'estimate' && activeRequestKey) {
      setLastScannedKey(activeRequestKey);
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

  return (
    <section className="card system-cleanup-panel" data-testid="system-cleanup-panel">
      <div className="system-cleanup-heading">
        <div>
          <span className="system-cleanup-eyebrow">DỌN FILE RÁC CÓ KIỂM SOÁT</span>
          <h2>Quét dung lượng, xem độ an toàn — chưa xóa</h2>
          <p>
            Tubmedia phân loại từng vùng dữ liệu và ước tính dung lượng. Đây là Giai đoạn 4a: chỉ quét và
            phân loại, xóa thật sẽ mở ở Giai đoạn 4b sau khi bạn xem kỹ kết quả này.
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
            <strong>Chỉ quét trong tài khoản hiện tại</strong>
            <em>Không đụng Windows Temp, Windows Update hay các khu vực cần quyền quản trị.</em>
          </div>
        </article>

        <article>
          <span className="cleanup-summary-icon">
            {scannedUpToDate ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div>
            <small>Trạng thái quét</small>
            <strong>{scannedUpToDate ? 'Đã quét xong lựa chọn hiện tại' : 'Chưa quét đúng lựa chọn'}</strong>
            <em>Xóa thật chưa mở ở bản này (Giai đoạn 4a).</em>
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
        và Zalo để số liệu quét chính xác hơn.
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

          {status.driveBefore && (
            <div className="cleanup-drive-comparison">
              <span>
                Trống lúc quét: <b>{formatBytes(status.driveBefore.freeBytes)}</b>
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
                      <b>{category?.label ?? 'Hạng mục'}:</b> ước tính {formatBytes(result.estimatedBytes)}
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
          disabled
          title="Xóa thật sẽ mở ở Giai đoạn 4b, sau khi bạn xem kỹ kết quả quét này và duyệt riêng. Bản này (Giai đoạn 4a) chỉ quét và phân loại."
        >
          Dọn dẹp và xóa file đã chọn (chưa mở ở bản này)
        </button>

        {running && (
          <button type="button" className="system-cleanup-button danger" onClick={() => void cancel()}>
            Yêu cầu dừng
          </button>
        )}
      </div>

      <p className="cleanup-action-note">
        Giai đoạn 4a chỉ quét và phân loại — nút xóa luôn bị khóa. Việc xóa/cách ly/hoàn tác thật sẽ có ở
        Giai đoạn 4b, sau khi bạn xem kỹ kết quả quét này.
      </p>
    </section>
  );
}
