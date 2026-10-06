/**
 * Đợt 2 mục 4 (2026-10-02): nhận diện thư mục CHUNG của người dùng/hệ thống không nên làm thư mục tạm
 * (Downloads, Desktop, Documents, Videos, Pictures, Music — kể cả bản trong OneDrive —, thư mục hồ sơ người
 * dùng, gốc ổ đĩa). Chỉ để CẢNH BÁO: Tubmedia không bao giờ tự đổi cấu hình hay di chuyển dữ liệu.
 * Hàm thuần (không đọc ổ đĩa) để dùng được cả ở giao diện lẫn tiến trình chính.
 */
export type SharedUserFolderKind =
  | 'downloads'
  | 'desktop'
  | 'documents'
  | 'videos'
  | 'pictures'
  | 'music'
  | 'profile'
  | 'drive-root';

const KNOWN_FOLDERS: Record<string, SharedUserFolderKind> = {
  downloads: 'downloads',
  desktop: 'desktop',
  documents: 'documents',
  videos: 'videos',
  pictures: 'pictures',
  music: 'music'
};

const KIND_LABEL: Record<SharedUserFolderKind, string> = {
  downloads: 'Tải xuống (Downloads)',
  desktop: 'Màn hình nền (Desktop)',
  documents: 'Tài liệu (Documents)',
  videos: 'Video (Videos)',
  pictures: 'Ảnh (Pictures)',
  music: 'Nhạc (Music)',
  profile: 'thư mục người dùng',
  'drive-root': 'gốc ổ đĩa'
};

export function sharedUserFolderKind(path: string): SharedUserFolderKind | null {
  const normalized = path.trim().replace(/\//g, '\\').replace(/\\+$/, '');
  if (!normalized) return null;
  if (/^[A-Za-z]:$/.test(normalized)) return 'drive-root';
  const profile = /^[A-Za-z]:\\Users\\[^\\]+$/i;
  if (profile.test(normalized)) return 'profile';
  const match = /^[A-Za-z]:\\Users\\[^\\]+\\(?:OneDrive(?: - [^\\]+)?\\)?([^\\]+)$/i.exec(normalized);
  if (!match) return null;
  return KNOWN_FOLDERS[match[1]!.toLowerCase()] ?? null;
}

export function sharedUserFolderLabel(kind: SharedUserFolderKind): string {
  return KIND_LABEL[kind];
}

/**
 * Câu giải thích đầy đủ cho nhãn ⚠ "Thư mục chung" cạnh tên ô thư mục tạm (hiện khi rê chuột/focus).
 * Sau phát hành 1.6.0 người dùng báo banner lớn đầu trang + dòng chữ dài dưới ô làm lệch bố cục → phương án A đã
 * duyệt (2026-10-06): bỏ banner, chỉ giữ nhãn nhỏ này. Dữ liệu "Không nhắc lại" đã lưu (dismissedSharedTempWarnings)
 * vẫn giữ nguyên trong cài đặt để quay lui an toàn, chỉ không còn dùng.
 */
export function sharedTempFolderWarning(path: string): string | null {
  const kind = sharedUserFolderKind(path);
  if (!kind) return null;
  return (
    `Đây là ${sharedUserFolderLabel(kind)} — thư mục dùng chung với tệp của bạn. Nên chọn một thư mục riêng ` +
    'cho Tubmedia (ví dụ một thư mục con mới) để tệp tạm không lẫn với tệp cá nhân.'
  );
}
