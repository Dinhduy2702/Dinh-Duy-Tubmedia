# Tubmedia FIX15 — Lag khi chạy nhiều danh sách: gộp gửi danh sách tác vụ + tick chỉ đọc tác vụ chưa xong (bước 3)

Bước cuối trong 3 bước của Phần 2 "lag khi tải 6 danh sách + edit" (bước 1: `FIX13_LANE_CONCURRENCY_CAP_VI.md`, bước 2:
`FIX14_JOB_START_PACING_VI.md`).

## Đo trước khi sửa (2026-10-12)

- Mỗi lần hàng đợi đổi trạng thái, `emit()` gửi **CẢ** danh sách tác vụ sang giao diện qua IPC ngay lập tức (250 tác vụ ≈450 KB,
  1500 ≈2,1 MB; 2000 tác vụ ≈1,3 MB trong phép đo dưới). e2e thật (2 danh sách × 4 video): khoảng cách giữa các lần gửi
  **15, 101, 47, 43, 74 ms…** — vòng lặp main khựng tới 837 ms khi nhiều lần gửi dồn, giao diện vẽ lại toàn bộ mỗi lần.
- Mỗi lượt tick (350 ms) đọc và phân tích **CẢ** bảng `queue_jobs`, kể cả hàng nghìn tác vụ đã xong (có lượt đọc 2 lần); xét phụ
  thuộc bằng `all.find` (O(n²)). 2000 tác vụ đã xong + 20 chờ: **12,9 ms** mỗi lần đọc.

## Cách sửa

- **Gộp gửi** (`sendQueueChanged`, `QUEUE_CHANGED_THROTTLE_MS = 300`, `src/main/queue/queue-manager.ts`): tối đa 1 lần gửi cả danh
  sách mỗi 300 ms. Thay đổi đầu tiên sau lúc yên **gửi ngay** (thao tác lẻ của người dùng không bị chậm); các thay đổi trong 300 ms
  sau đó gộp vào **đúng 1 lần gửi cuối**, đọc dữ liệu **mới nhất** lúc gửi. Dừng hàng đợi thì hủy lần gửi đang chờ. Bộ lập lịch
  vẫn được đánh thức ngay mỗi thay đổi như cũ; tiến độ từng tác vụ (`jobProgress`) vẫn đi riêng, không bị gộp.
- **Tick chỉ đọc tác vụ chưa xong** (`QueueRepository.listUnfinished`): bỏ completed / skipped / cancelled / failed. Phụ thuộc đã
  xong (không còn trong danh sách) tra trạng thái theo id (`statusesById`, tối đa 500 id mỗi truy vấn); id không tồn tại vẫn tính là
  phụ thuộc hỏng như cũ. Xét phụ thuộc bằng Map thay cho `all.find`. Đo lại: **0,64 ms** (≈20 lần nhanh hơn).

## Kiểm tra

- Integration `queue-ipc-coalesce` (mã cũ: đỏ 3/4): 20 thay đổi liên tiếp → 1 lần gửi ngay + 1 lần gửi cuối sau ≥280 ms có đủ 20
  tác vụ (mã cũ 20 lần gửi); thay đổi lẻ sau lúc yên vẫn gửi ngay; dừng hàng đợi thì không gửi thêm; 2000 tác vụ đã xong — tick
  không gọi `list()` cả bảng (mã cũ: 2 lần), phụ thuộc đã xong → chạy, lỗi / không tồn tại → DEPENDENCY_FAILED, còn chờ → chờ,
  phụ thuộc vừa chuyển sang xong → tác vụ sau được chạy.
- e2e "Lag bước 2 + 3" — yt-dlp thật, 2 danh sách × 4 video tới khi xong cả 8: giao diện ghi lại mỗi lần nhận danh sách; không có
  hai lần gửi cách nhau dưới 250 ms, lần gửi cuối có đủ 8 video đã xong (mã cũ: đỏ — 15 ms).

## Ghi chú phát hành (đưa vào CHANGELOG lúc bump)

- Giao diện nhận danh sách công việc tối đa ~3 lần mỗi giây thay vì mỗi lần có thay đổi, và hàng đợi không còn đọc lại toàn bộ
  lịch sử công việc đã xong mỗi 0,35 giây — ứng dụng mượt hơn khi chạy nhiều danh sách và khi lịch sử dài.
