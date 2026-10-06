/**
 * Mục 5 (2026-10-02) — ngưỡng cảnh báo khu cách ly của danh sách, do người dùng chọn: khu cách ly GIỮ bản cũ,
 * không tự xóa; chỉ cảnh báo khi tổng dung lượng vượt 20 GB hoặc ổ chứa khu cách ly còn dưới 10% trống.
 */
export const QUARANTINE_WARN_BYTES = 20 * 1024 ** 3;
export const QUARANTINE_WARN_FREE_RATIO = 0.1;

/** Khu cách ly 14 ngày của Dọn dẹp máy: nhắc khi có mục sẽ bị xóa vĩnh viễn trong khoảng này. */
export const CLEANUP_QUARANTINE_REMIND_MS = 2 * 24 * 60 * 60 * 1000;
