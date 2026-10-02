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

/** Lời cảnh báo ngắn dưới ô chọn thư mục tạm. */
export function sharedTempFolderWarning(path: string): string | null {
  const kind = sharedUserFolderKind(path);
  if (!kind) return null;
  return (
    `Đây là ${sharedUserFolderLabel(kind)} — thư mục dùng chung với tệp của bạn. Nên chọn một thư mục riêng ` +
    'cho Tubmedia (ví dụ một thư mục con mới) để tệp tạm không lẫn với tệp cá nhân.'
  );
}

export interface SharedTempFolderNoticeItem {
  id: string;
  name: string;
  tempFolder: string;
}

/**
 * Thông báo khi mở app: các danh sách đang dùng thư mục chung làm thư mục tạm. Không tự đổi gì.
 * `dismissed`: { mã danh sách → thư mục tạm lúc người dùng chọn "Không nhắc lại" }. Chỉ còn hiệu lực khi danh
 * sách vẫn dùng ĐÚNG thư mục đó; đổi sang thư mục chung khác thì nhắc lại.
 */
export function buildSharedTempFolderNotice(
  projects: ReadonlyArray<SharedTempFolderNoticeItem>,
  dismissed: Readonly<Record<string, string>> = {}
): { title: string; message: string; items: SharedTempFolderNoticeItem[] } | null {
  const items = projects
    .filter((project) => sharedUserFolderKind(project.tempFolder) !== null)
    .filter((project) => dismissed[project.id] !== project.tempFolder)
    .map(({ id, name, tempFolder }) => ({ id, name, tempFolder }));
  if (items.length === 0) return null;
  return {
    title: `${items.length} danh sách đang dùng thư mục chung làm thư mục tạm`,
    message:
      'Tubmedia chỉ dọn thư mục do chính nó tạo nên tệp của bạn an toàn, nhưng nên đổi sang một thư mục riêng ' +
      'khi danh sách đã xong. Tubmedia không tự di chuyển hay đổi gì.',
    items
  };
}
