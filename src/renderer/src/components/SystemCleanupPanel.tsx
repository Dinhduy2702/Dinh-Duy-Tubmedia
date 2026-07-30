import { AlertTriangle, CheckCircle2, HardDrive, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  SYSTEM_CLEANUP_CATEGORIES,
  isIrreversibleCleanupSelection,
  systemCleanupRequiresAdmin,
  type SystemCleanupCategoryId,
  type SystemCleanupScope,
  type SystemCleanupStatus
} from '@shared/system-cleanup';

type SafetyTone = 'very-safe' | 'safe' | 'caution' | 'system';

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

const WHOLE_MACHINE_SCAN_CATEGORIES: SystemCleanupCategoryId[] = [
  'userTemp',
  'thumbnailCache',
  'crashReports',
  'browserCache',
  'capcutCache',
  'zaloCache',
  'recycleBin',
  'windowsTemp',
  'windowsUpdate',
  'deliveryOptimization',
  'componentStore'
];

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
    description: 'Chỉ xóa báo cáo lỗi cũ, không xóa ứng dụng.',
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
  recycleBin: {
    label: 'Cần kiểm tra',
    description: 'Tệp trong Thùng rác sẽ bị xóa vĩnh viễn.',
    tone: 'caution'
  },
  windowsTemp: {
    label: 'An toàn',
    description: 'Bỏ qua tệp hệ thống hoặc tệp đang bị khóa.',
    tone: 'safe'
  },
  windowsUpdate: {
    label: 'Cần kiểm tra',
    description: 'Dịch vụ cập nhật sẽ được dừng tạm rồi khởi động lại.',
    tone: 'caution'
  },
  deliveryOptimization: {
    label: 'An toàn',
    description: 'Chỉ dọn cache phân phối cập nhật của Windows.',
    tone: 'safe'
  },
  componentStore: {
    label: 'Cần kiểm tra',
    description: 'DISM dọn thành phần Windows cũ và có thể chạy nhiều phút.',
    tone: 'caution'
  },
  disableHibernate: {
    label: 'Thay đổi hệ thống',
    description: 'Tắt Hibernate và xóa hiberfil.sys; chỉ dùng khi thực sự cần.',
    tone: 'system'
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

function needMeta(bytes: number, id?: SystemCleanupCategoryId): NeedMeta {
  if (id === 'disableHibernate') {
    return {
      label: 'Chỉ khi cần',
      description: 'Không nên dùng như một thao tác dọn rác thông thường.',
      tone: 'high'
    };
  }

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

function scanKey(scope: SystemCleanupScope, categories: readonly SystemCleanupCategoryId[]): string {
  return `${scope}:${[...categories].sort().join(',')}`;
}

function cleanupStatusMessage(status: SystemCleanupStatus): string {
  const category = SYSTEM_CLEANUP_CATEGORIES.find((item) => status.message.includes(item.id));

  if (!terminalPhases.has(status.phase)) {
    if (category) {
      return `${status.mode === 'estimate' ? 'Đang quét' : 'Đang dọn'}: ${category.label}`;
    }

    return status.mode === 'estimate' ? 'Đang quét và tính dung lượng...' : 'Đang dọn dẹp file đã chọn...';
  }

  if (status.phase === 'completed') {
    return status.mode === 'estimate' ? 'Quét dung lượng hoàn tất' : 'Dọn dẹp hoàn tất';
  }

  if (status.phase === 'cancelled') {
    return 'Đã dừng theo yêu cầu';
  }

  return status.phase === 'failed' ? 'Dọn dẹp gặp lỗi' : status.message;
}

export function SystemCleanupPanel(): React.JSX.Element {
  const defaultSelection = useMemo(
    () => SYSTEM_CLEANUP_CATEGORIES.filter((item) => item.defaultSelected).map((item) => item.id),
    []
  );
  const [selected, setSelected] = useState<SystemCleanupCategoryId[]>(defaultSelection);
  const [scope, setScope] = useState<SystemCleanupScope>('currentUser');
  const [status, setStatus] = useState<SystemCleanupStatus | null>(null);
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null);
  const [lastScannedKey, setLastScannedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = Boolean(status && !terminalPhases.has(status.phase));
  const currentScanKey = scanKey(scope, selected);
  const requiresAdmin = systemCleanupRequiresAdmin(selected, scope);

  const resultById = new Map(status?.results.map((result) => [result.id, result]) ?? []);
  const selectedEstimatedBytes = selected.reduce(
    (total, id) => total + (resultById.get(id)?.estimatedBytes ?? 0),
    0
  );
  const overallNeed = needMeta(selectedEstimatedBytes);
  const canClean =
    !running &&
    selected.length > 0 &&
    lastScannedKey === currentScanKey &&
    status?.mode === 'estimate' &&
    status.phase === 'completed';

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
        setError(pollError instanceof Error ? pollError.message : 'Không đọc được tiến trình dọn dẹp.');
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

  async function start(
    mode: 'estimate' | 'clean',
    categories: SystemCleanupCategoryId[] = selected,
    requestScope: SystemCleanupScope = scope
  ): Promise<void> {
    setError(null);

    if (categories.length === 0) {
      setError('Hãy chọn ít nhất một hạng mục.');
      return;
    }

    const requestKey = scanKey(requestScope, categories);
    const categoryItems = SYSTEM_CLEANUP_CATEGORIES.filter((item) => categories.includes(item.id));

    if (mode === 'clean' && lastScannedKey !== requestKey) {
      setError('Hãy quét dung lượng với đúng phạm vi và hạng mục hiện tại trước khi xóa.');
      return;
    }

    if (mode === 'clean') {
      const names = categoryItems.map((item) => `• ${item.label}`).join('\n');
      const scopeText =
        requestScope === 'wholeMachine'
          ? 'Mọi hồ sơ Windows và các ổ đĩa cố định'
          : 'Tài khoản Windows hiện tại';
      const confirmed = window.confirm(
        `Dung lượng dự kiến có thể giải phóng: ${formatBytes(selectedEstimatedBytes)}\n` +
          `Phạm vi: ${scopeText}\n\n` +
          `Tubmedia sẽ dọn:\n${names}\n\n` +
          'Tệp đang được sử dụng sẽ bị bỏ qua. Tiếp tục?'
      );

      if (!confirmed) {
        return;
      }

      if (categories.includes('disableHibernate')) {
        const phrase = window.prompt(
          'Tắt ngủ đông sẽ thay đổi tính năng nguồn của Windows.\n' +
            'Nhập chính xác "TAT NGU DONG" để xác nhận:'
        );

        if (phrase !== 'TAT NGU DONG') {
          setError('Đã hủy thao tác tắt chế độ ngủ đông.');
          return;
        }
      }

      if (isIrreversibleCleanupSelection(categories)) {
        const irreversibleConfirmed = window.confirm(
          'Lựa chọn có thao tác không thể hoàn tác, ví dụ xóa Thùng rác. Bạn xác nhận tiếp tục?'
        );

        if (!irreversibleConfirmed) {
          return;
        }
      }
    }

    try {
      setScope(requestScope);
      setSelected(categories);
      setActiveRequestKey(requestKey);

      const next = await window.desktop.systemCleanup.start({
        mode,
        scope: requestScope,
        categories
      });

      setStatus(next);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Không thể bắt đầu dọn dẹp.');
    }
  }

  async function scanWholeMachine(): Promise<void> {
    await start('estimate', WHOLE_MACHINE_SCAN_CATEGORIES, 'wholeMachine');
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
      setError(cancelError instanceof Error ? cancelError.message : 'Không gửi được yêu cầu dừng.');
    }
  }

  return (
    <section className="card system-cleanup-panel" data-testid="system-cleanup-panel">
      <div className="system-cleanup-heading">
        <div>
          <span className="system-cleanup-eyebrow">DỌN FILE RÁC CÓ KIỂM SOÁT</span>
          <h2>Quét dung lượng, xem độ an toàn rồi mới xóa</h2>
          <p>
            Tubmedia phân loại từng vùng dữ liệu, ước tính dung lượng và khóa nút xóa cho đến khi hoàn tất một
            lần quét đúng với lựa chọn hiện tại.
          </p>
        </div>

        <div className="system-cleanup-admin-badge">
          {scope === 'wholeMachine'
            ? 'Toàn máy • cần UAC'
            : requiresAdmin
              ? 'Hạng mục cần UAC'
              : 'Tài khoản hiện tại'}
        </div>
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
            <strong>Chỉ vị trí cho phép</strong>
            <em>Không quét xóa tùy tiện ổ đĩa.</em>
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
        <span className="safety-caution">Cần kiểm tra: xóa vĩnh viễn hoặc tác vụ Windows</span>
        <span className="safety-system">Thay đổi hệ thống: chỉ dùng khi hiểu rõ</span>
      </div>

      <div className="system-cleanup-warning">
        Không xóa Desktop, Documents, Downloads, Pictures, Videos, Zalo Received Files, thư mục gốc
        CapCut/Zalo, dữ liệu dự án Tubmedia, Windows.old hoặc Restore Point. Hãy đóng Chrome, Edge, CapCut và
        Zalo để dọn được nhiều hơn.
      </div>

      {(['safe', 'advanced'] as const).map((group) => (
        <div className="system-cleanup-group" key={group}>
          <div className="system-cleanup-group-title">
            {group === 'safe' ? 'Dọn dẹp thông thường' : 'Tùy chọn nâng cao'}
          </div>

          <div className="system-cleanup-grid">
            {SYSTEM_CLEANUP_CATEGORIES.filter((item) => item.group === group).map((item) => {
              const checked = selected.includes(item.id);
              const result = resultById.get(item.id);
              const safety = SAFETY_META[item.id];
              const need = needMeta(result?.estimatedBytes ?? 0, item.id);

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
                      {item.requiresAdmin && <em>Quyền quản trị</em>}
                      {item.irreversible && <em>Không thể hoàn tác</em>}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {error && <div className="system-cleanup-error">{error}</div>}

      {status && (
        <div className="system-cleanup-progress-card">
          <div className="system-cleanup-progress-head">
            <strong>{cleanupStatusMessage(status)}</strong>
            <span>{Math.max(0, Math.min(100, status.progress))}%</span>
          </div>

          <div className="system-cleanup-progress-track">
            <span style={{ width: `${status.progress}%` }} />
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

          {(status.driveBefore || status.driveAfter) && (
            <div className="cleanup-drive-comparison">
              <span>
                Trống trước khi dọn: <b>{formatBytes(status.driveBefore?.freeBytes ?? 0)}</b>
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
              <pre>
                {status.results
                  .map((result) => {
                    const category = SYSTEM_CLEANUP_CATEGORIES.find((item) => item.id === result.id);
                    return `${category?.label ?? result.id}: ${formatBytes(result.estimatedBytes)} | đã xóa ${formatBytes(result.removedBytes)} | bỏ qua ${result.skippedItems}`;
                  })
                  .join('\n')}
              </pre>
            </details>
          )}

          {status.errors.length > 0 && (
            <details className="system-cleanup-errors">
              <summary>{status.errors.length} lỗi hoặc mục không thể xử lý</summary>
              <pre>{status.errors.join('\n')}</pre>
            </details>
          )}
        </div>
      )}

      <div className="system-cleanup-actions">
        <button
          type="button"
          className="system-cleanup-button secondary whole-machine"
          disabled={running}
          onClick={() => void scanWholeMachine()}
        >
          Quét thông minh toàn bộ máy
        </button>

        <button
          type="button"
          className="system-cleanup-button secondary"
          disabled={running || selected.length === 0}
          onClick={() => void start('estimate')}
        >
          Quét mục đã chọn
        </button>

        <button
          type="button"
          className="system-cleanup-button primary"
          disabled={!canClean}
          title={canClean ? 'Xóa các file rác đã quét' : 'Phải quét đúng lựa chọn hiện tại trước khi xóa'}
          onClick={() => void start('clean')}
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
          Nút xóa được khóa cho đến khi bạn quét xong đúng phạm vi và hạng mục đang chọn.
        </p>
      )}
    </section>
  );
}
