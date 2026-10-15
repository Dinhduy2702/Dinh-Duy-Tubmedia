# Tubmedia FIX16 — HTTP 429 hướng C: giãn nhịp chủ động với nền tảng; ghi đúng sự thật về aria2c

Hướng C trong kế hoạch 429 ("A + B rồi C"; A + B: `FIX12_RATE_LIMIT_429_PLATFORM_WAIT_VI.md`, `FIX13_LANE_CONCURRENCY_CAP_VI.md`).

## Kế hoạch gốc và điều đo được (2026-10-13)

Hướng C gốc gồm 3 ý: (1) `--sleep-requests` ~1 s + nghỉ ngắn giữa các video khi nhiều video cùng nền tảng; (2) giảm kết nối aria2c
với YouTube 16 → 4–8; (3) sau 429 cho aria2c thử lại chờ lâu dần thay vì cố định 3 s.

Đo bằng **công cụ thật** trong `tool/` (yt-dlp 2026.08.19, aria2c 1.37.0), máy chủ cục bộ http và https (chứng chỉ tự ký):

- Cờ app đang dùng `--downloader http,https:<đường dẫn aria2c>` → yt-dlp báo **"Invoking http downloader"** (bộ tải có sẵn của
  yt-dlp, 2 kết nối) với cả http lẫn https: `https` không phải khóa giao thức hợp lệ của yt-dlp nên cả cụm bị bỏ qua. Viết
  `http:<đường dẫn>` mới gọi aria2c (`-x 16` → 8 kết nối đồng thời, `-x 4` → 4). Vậy **aria2c chưa từng được dùng**; ô "Kết nối aria2c
  mỗi video" không có tác dụng.
- aria2c gặp 429 thì **dừng ngay** (errorCode=22, `status=429`), không thử lại → `--retry-wait` không có tác dụng với 429.
- `--sleep-requests` / `--sleep-interval` / `--max-sleep-interval` chạy thật (`[download] Sleeping 2.92 seconds ...`).

**Người dùng chọn:** chỉ giãn nhịp, giữ đúng thực tế (bộ tải có sẵn của yt-dlp, ít kết nối — đỡ bị giới hạn hơn bật aria2c); bỏ ý (2)
và (3) vì không có tác dụng; sửa ô aria2c trên giao diện cho đúng sự thật.

## Cách sửa

- `downloadPacingArgs` (`src/shared/utils/download-pacing.ts`), chỉ cho nền tảng có tên (YouTube, TikTok, Instagram, Facebook, X,
  Google Drive, Vimeo, Reddit, Dailymotion, Twitch, SoundCloud) — link tệp trực tiếp giữ nguyên:
  - một video lẻ: không nghỉ;
  - từ **2 video cùng nền tảng** tải song song (toàn ứng dụng, cả làn ghép): `--sleep-requests 1 --sleep-interval 1 --max-sleep-interval 3`;
  - nền tảng **vừa dính 429** (còn trong chuỗi của hướng B): `--sleep-requests 2 --sleep-interval 3 --max-sleep-interval 8`, kể cả video lẻ.
- Hàng đợi truyền cho bộ tải `{ samePlatformActive, rateLimitStrikes }` (`downloadPacingContext`, `PlatformRateLimitGate.strikesOf`).
  Áp cho cả lượt thử lại (không kèm cờ aria2c). Nhật ký `DOWNLOAD_PACING_APPLIED`.
- Cờ aria2c trong `download-engine.ts` **giữ nguyên** (hành vi không đổi), kèm chú thích điều đã đo.
- Cài đặt › Tải danh sách: gỡ hai ô "Dùng aria2c khi khả dụng" / "Kết nối aria2c mỗi video", thay bằng ghi chú "Video được tải bằng bộ
  tải có sẵn của yt-dlp (ít kết nối, đỡ bị nền tảng giới hạn) — hiện không dùng aria2c." Bỏ câu "aria2c 16 kết nối" ở phần giới thiệu
  chế độ tải (Cài đặt và Tải danh sách). Giá trị cài đặt cũ vẫn lưu nguyên (quay lui bản cũ không hỏng).

## Kiểm tra

- Integration `download-pacing-args` (DownloadEngine.run() thật, chỉ giả tiến trình yt-dlp): 6 video YouTube → có `--sleep-requests 1`…,
  vừa dính 429 → `--sleep-requests 2`…, lượt thử lại vẫn giãn nhịp; video lẻ / link trực tiếp không nghỉ; cờ aria2c không đổi (mã cũ: đỏ 3/5).
- Integration hàng đợi: video YouTube thứ n nhận `samePlatformActive = n`, TikTok đếm riêng; video tự tiếp tục sau 429 nhận
  `rateLimitStrikes = 1` (mã cũ: đỏ — không truyền gì).
- Unit `download-pacing`.
- e2e "Hướng C 429: yt-dlp thật…" — tool/yt-dlp.exe thật, máy chủ cục bộ: video lẻ không nghỉ; 6 video → nghỉ 1–3 s rồi tải đủ tệp;
  vừa dính 429 → nghỉ 3–8 s rồi tải đủ tệp.
- e2e "Cài đặt › Tải danh sách: không còn ô aria2c giả…" (mã cũ: đỏ — ô "Kết nối aria2c mỗi video" vẫn hiện).

## Ghi chú phát hành (đưa vào CHANGELOG lúc bump)

- Khi nhiều video cùng một nền tảng (YouTube, TikTok…) tải song song, ứng dụng nghỉ ngắn giữa các yêu cầu (khoảng 1 giây, và 1–3 giây
  trước mỗi video) để đỡ bị nền tảng giới hạn (HTTP 429); nền tảng vừa giới hạn thì nghỉ lâu hơn. Link tệp trực tiếp không bị ảnh hưởng.
- Cài đặt: bỏ hai ô aria2c không có tác dụng — ứng dụng tải bằng bộ tải có sẵn của yt-dlp.
