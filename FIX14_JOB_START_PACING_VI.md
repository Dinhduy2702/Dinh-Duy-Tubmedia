# Tubmedia FIX14 — Lag khi chạy nhiều danh sách: bắt đầu dần (bước 2)

Bước 2 trong 3 bước của Phần 2 "lag khi tải 6 danh sách + edit" (bước 1: `FIX13_LANE_CONCURRENCY_CAP_VI.md`).

## Đo trước khi sửa (2026-10-12)

- Mỗi lần mở yt-dlp (bản PyInstaller phải giải nén) tốn **≈0,77 s CPU**. Một lượt tick mở **hết** mọi video còn chỗ trong cùng một
  lúc. e2e thật (yt-dlp, 2 danh sách × 4 luồng): `startedAt` lệch so với video đầu **0, 11, 13, 16, 397, 402, 406, 409 ms** — 4 tiến
  trình trong 16 ms, rồi 4 cái nữa.
- Nhịp tick 350 ms không phải giới hạn thật: mỗi lần hàng đợi đổi trạng thái (`emit()` — thêm tác vụ, tác vụ xong, đổi trạng
  thái) đều gọi `wakeScheduler()` → tick **ngay lập tức**. Vì vậy chỉ đếm "mỗi lượt tick 2 tác vụ" không đủ: các lượt tick sát nhau
  vẫn mở dồn (đo được hai lượt cách nhau 72 ms).

## Cách sửa

- Tối đa **2 tác vụ được BẮT ĐẦU trong mỗi 350 ms** (`MAX_JOB_STARTS_PER_WINDOW`, `JOB_START_WINDOW_MS`,
  `src/shared/utils/queue-lane.ts`), tính theo **thời gian** — mọi lượt tick trong cùng 350 ms chung một suất. Hàng đợi giữ mốc các
  lần bắt đầu gần đây (`jobStartTimes`, lọc bằng `recentJobStarts`; mốc "tương lai" khi đồng hồ máy bị lùi thì bỏ).
- Áp cho mọi loại tác vụ (đều mở tiến trình con: yt-dlp / ffmpeg / ffprobe).
- **Số chạy cùng lúc không đổi** — trần ở bước 1 vẫn như cũ; chỉ thời điểm bắt đầu trải ra: 8 video đủ chỗ trong ≈1,05 s thay vì
  vài ms.
- Lượt tick đã hết suất vẫn xét làn của các tác vụ còn lại để báo đúng danh sách "Đang chờ lượt" (không nhấp nháy).

## Kiểm tra

- Integration `queue-list-concurrency` (tick THẬT, đồng hồ Date giả lập): mỗi lượt tick cách 400 ms → số video đã bắt đầu
  `[2, 4, 6, 8, 8]` (mã cũ `[8, 8, 8, 8, 8]`); 4 lượt tick sát nhau chỉ mở 2 (mã cũ 8), 349 ms sau vẫn 2, 350 ms thì 4; lượt hết
  suất vẫn báo đúng danh sách chờ lượt. Các bài bước 1 chạy đủ lượt tick để lấp chỗ — trần không đổi.
- Integration `queue-rate-limit-platform-wait`: mỗi lượt tick coi như cửa sổ mới (nhịp bắt đầu dần có bài riêng), hành vi 429 không
  đổi.
- Unit `queue-lane`: hằng số + `recentJobStarts`.
- e2e "Lag bước 2" — yt-dlp thật, máy chủ cục bộ trả video chậm, 2 danh sách × 4 luồng (hồ sơ Toàn bộ hiệu năng): không lúc nào có
  quá 2 video bắt đầu trong cùng 300 ms, 8 video trải ra ≥ 900 ms, máy chủ vẫn thấy đủ 8 video tải cùng lúc (mã cũ: đỏ — 4 video
  trong 16 ms).

## Ghi chú phát hành (đưa vào CHANGELOG lúc bump)

- Khi bấm tải nhiều danh sách cùng lúc, ứng dụng bắt đầu các video dần dần (tối đa 2 video mỗi 0,35 giây) thay vì mở hết một lúc —
  máy không còn khựng lúc bắt đầu; số video tải cùng lúc vẫn như cũ.
