/**
 * Tên tệp tải về luôn vừa giới hạn đường dẫn cổ điển của Windows (2026-10-23).
 *
 * yt-dlp (Python) trên máy chưa bật LongPathsEnabled không mở được tệp có đường dẫn ≥ 260 ký tự và báo
 * "unable to open for writing: [Errno 2] No such file or directory". Trước đây tiêu đề luôn được cắt ở 165 byte bất kể
 * thư mục lưu dài bao nhiêu, còn tệp tạm của yt-dlp nối thêm ".f<mã định dạng>.<đuôi>.part" (mã định dạng Facebook dài
 * 16–17 chữ số) → video Facebook tiêu đề dài trong thư mục "E:\DinhDuy\NA401_Bẫy lợn\video" vượt 260 ký tự.
 *
 * Độ dài tính theo đơn vị UTF-16 như Windows; tiêu đề được yt-dlp cắt theo BYTE UTF-8 (%(title).NB) — mỗi ký tự luôn tốn
 * ít nhất bằng số đơn vị UTF-16 của nó, nên N byte không bao giờ vượt N đơn vị.
 */

/** MAX_PATH 260 gồm ký tự kết thúc → tối đa 259 ký tự (cùng mức với khu cách ly, xem quarantine-location.ts). */
export const WINDOWS_MAX_PATH_LENGTH = 259;

/**
 * Phần yt-dlp nối sau tên khi đang tải: tệp tạm từng luồng ".f<mã định dạng ≤ 24>.<đuôi ≤ 4>.part" (Facebook
 * ".f1205344837823463v.mp4.part" = 28), mảnh HLS ".f270.mp4.part-Frag12345.part" (31), tệp ghép ".temp.mp4". Trường hợp
 * hiếm dài hơn (mã định dạng rất dài kèm mảnh) → yt-dlp báo đường dẫn dài và lượt thử lại tự đặt tên ngắn hơn.
 */
export const YTDLP_WORKING_SUFFIX_RESERVE = 36;

/** Mã video chưa biết trước (YouTube 11, Facebook 16, TikTok 19 ký tự) → dành sẵn chừng này. */
export const MEDIA_ID_LENGTH_RESERVE = 24;

/** Chỗ cho tiêu đề ít hơn mức này thì bỏ hẳn tiêu đề, đặt tên "Video [mã] [LINK_…]". */
export const MIN_TITLE_BYTES = 12;

/** Tên thay cho tiêu đề khi không còn chỗ (giống nhánh tên gọn của Tải nhanh). */
export const UNTITLED_DOWNLOAD_NAME = 'Video';

export interface DownloadNamePlanInput {
  /** Thư mục chứa tệp cuối (thư mục nguồn của danh sách). */
  homeFolder: string;
  /** Thư mục chứa tệp tạm của yt-dlp. */
  workFolder: string;
  /** Độ dài phần cố định quanh mã video, không gồm tiêu đề và mã video: " [Nguon-…] [" + "]" + " [LINK_…]". */
  fixedLength: number;
  mediaIdLength?: number | null | undefined;
  /** Mức cắt tiêu đề khi thư mục đủ ngắn — giữ đúng mức cũ để tên tệp không đổi với người không vướng giới hạn. */
  maxTitleBytes: number;
  /** Số lần yt-dlp đã báo đường dẫn quá dài cho tác vụ này: 1 → tiêu đề ngắn một nửa, ≥ 2 → bỏ tiêu đề. */
  pathStrikes?: number | undefined;
}

export type DownloadNamePlan =
  | { kind: 'title'; titleBytes: number }
  | { kind: 'untitled' }
  | { kind: 'folder-too-long'; folder: string; folderLength: number; maxFolderLength: number };

export function planDownloadName(input: DownloadNamePlanInput): DownloadNamePlan {
  const folder = input.workFolder.length > input.homeFolder.length ? input.workFolder : input.homeFolder;
  const idLength = input.mediaIdLength && input.mediaIdLength > 0 ? input.mediaIdLength : MEDIA_ID_LENGTH_RESERVE;
  // Phần tên còn lại cho tiêu đề sau khi trừ thư mục, dấu "\", phần cố định, mã video và đuôi tệp tạm.
  const room = WINDOWS_MAX_PATH_LENGTH - folder.length - 1 - input.fixedLength - idLength - YTDLP_WORKING_SUFFIX_RESERVE;
  if (room < UNTITLED_DOWNLOAD_NAME.length) {
    return {
      kind: 'folder-too-long',
      folder,
      folderLength: folder.length,
      maxFolderLength: folder.length - (UNTITLED_DOWNLOAD_NAME.length - room)
    };
  }
  const strikes = Math.max(0, Math.trunc(input.pathStrikes ?? 0));
  if (strikes >= 2) return { kind: 'untitled' };
  const fitted = Math.min(input.maxTitleBytes, room);
  const titleBytes = strikes === 1 ? Math.floor(fitted / 2) : fitted;
  return titleBytes < MIN_TITLE_BYTES ? { kind: 'untitled' } : { kind: 'title', titleBytes };
}
