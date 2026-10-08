import { useState, type ChangeEvent } from 'react';
import { AlertTriangle, CopyCheck, FolderOpen, LoaderCircle } from 'lucide-react';
import { useAppStore } from '../stores/app-store';
import { HoverTip } from './HoverTip';
import { sharedTempFolderWarning, sharedUserFolderKind } from '@shared/utils/shared-folder-policy';

interface FolderFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Ô thư mục TẠM: gợi ý nhẹ khi người dùng chọn thư mục chung (Downloads, Desktop, gốc ổ đĩa...). */
  warnIfSharedTemp?: boolean;
  /**
   * Thư mục tạm mà người dùng đã chọn "Không nhắc lại" cho danh sách này (cài đặt dismissedSharedTempWarnings).
   * Chỉ còn hiệu lực khi ô vẫn là ĐÚNG thư mục đó — đổi sang thư mục chung khác thì gợi ý lại.
   */
  sharedTempDismissedFolder?: string;
  /**
   * Phần C (2026-10-06): CHỈ ô thư mục TẠM — nút nhỏ cùng hàng nút Chọn để áp dụng thư mục này cho tất cả danh sách của
   * trang (trang tự mở hộp xác nhận). Không truyền thì không có nút.
   */
  onApplyToAll?: () => void;
}

export function FolderField({
  label,
  value,
  onChange,
  disabled = false,
  warnIfSharedTemp = false,
  sharedTempDismissedFolder,
  onApplyToAll
}: FolderFieldProps): React.JSX.Element {
  const dismissed = sharedTempDismissedFolder !== undefined && sharedTempDismissedFolder === value;
  const sharedWarning =
    warnIfSharedTemp && !dismissed && sharedUserFolderKind(value) ? sharedTempFolderWarning(value) : null;
  const [choosing, setChoosing] = useState(false);
  const choose = async (): Promise<void> => {
    if (disabled || choosing) return;
    setChoosing(true);
    try {
      const result = await window.desktop.dialogs.chooseFolder(value.trim() || undefined);
      if (result) onChange(result.path);
    } catch (error) {
      useAppStore.getState().setError(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosing(false);
    }
  };

  return <label>
    <span className="label folder-field-label">
      {label}
      {/* Sau phát hành 1.6.0 (2026-10-06): chỉ một icon ⚠ nhỏ CÙNG HÀNG với tên ô — không thêm chiều cao nên các ô
          trong hàng cấu hình (lưới căn đáy) vẫn thẳng nhau; dòng chữ dài dưới ô trước đây làm lệch cả hàng. Câu đầy
          đủ chỉ hiện khi rê chuột/focus. Chỉ là gợi ý: giữ thư mục chung vẫn dùng bình thường, không chặn gì. */}
      {sharedWarning && (
        <HoverTip text={sharedWarning} className="shared-folder-chip" tone="warning">
          <AlertTriangle size={12} aria-hidden="true" />
        </HoverTip>
      )}
    </span>
    <div className="flex gap-2">
      <input
        className="input"
        value={value}
        disabled={disabled || choosing}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <button type="button" className="btn" disabled={disabled || choosing} onClick={() => void choose()}>
        {choosing ? <LoaderCircle className="animate-spin" size={17}/> : <FolderOpen size={17}/>}
        {choosing ? 'Đang mở...' : 'Chọn'}
      </button>
      {onApplyToAll && (
        <button
          type="button"
          className="btn folder-apply-all"
          title="Áp dụng thư mục tạm này cho tất cả danh sách"
          aria-label="Áp dụng thư mục tạm này cho tất cả danh sách"
          disabled={disabled || choosing || !value.trim()}
          onClick={onApplyToAll}
        >
          <CopyCheck size={17} />
        </button>
      )}
    </div>
  </label>;
}
