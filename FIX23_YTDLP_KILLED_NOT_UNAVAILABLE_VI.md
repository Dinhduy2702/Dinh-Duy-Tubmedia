# FIX23 — yt-dlp bị dừng ngang không còn bị báo nhầm "Video không khả dụng" (và được thử lại)

## Vụ việc

Lượt build 1.7.0 trên GitHub Actions (run 38719487195, lượt chạy lại) hỏng ở bài e2e "Khởi động: tác vụ tạo ngay khi vừa
mở app không bị giữ nhầm là 'dở dang'; tác vụ dở của lần trước vẫn bị giữ": tác vụ dở của lần trước là `failed` thay vì
`paused` / `APP_INTERRUPTED`.

Đo trên máy dev (chạy riêng bài, gắn log đọc CSDL ngay sau khi giết app):

| Mã | Máy | Kết quả |
|---|---|---|
| main 1.7.0 | 36 lõi | 6/6 xanh |
| main 1.7.0 | 2 lõi (`start /affinity 3`) | 2/8 đỏ |
| 1.6.3 (`861367d`) | 2 lõi | 1/8 đỏ — có từ trước |

Lượt đỏ: ngay sau khi giết app, tác vụ đã `failed` · `DOWNLOAD_FAILED` · "Video không khả dụng hoặc nền tảng đang từ chối truy
cập…". `taskkill /T /F` giết yt-dlp trước tiến trình chính vài ms; trong khoảng đó tiến trình chính thấy yt-dlp thoát lỗi
và ghi kết quả. yt-dlp bị giết không in câu lỗi nào (đo thật: mã 1, stderr rỗng, stdout chỉ có
`[generic] Extracting URL: …` / `[generic] video: Downloading webpage`) → `classifyYtDlpFailure` không nhận ra → nhánh cuối
`unknown`, không thử lại → DownloadEngine báo "Video không khả dụng…".

Ngoài đời: yt-dlp bị giết từ bên ngoài (Task Manager tắt cả cây tiến trình, phần mềm diệt virus, Windows tắt máy) thì video
bị đánh dấu hỏng vĩnh viễn với lý do sai.

## Sửa

- `classifyYtDlpFailure`: không nhận ra loại lỗi VÀ không có dòng `ERROR:` (kể cả dạng `[extractor] ERROR:`) hay
  `Traceback` → loại mới `interrupted`, `retryable` — tiến trình bị dừng ngang, thử lại được. Có `ERROR:` mà không nhận
  ra → vẫn `unknown`, không thử lại. Mọi loại đã nhận ra giữ nguyên.
- DownloadEngine: `interrupted` → "Tiến trình tải bị dừng đột ngột mà không có thông báo lỗi nào … Tubmedia sẽ thử tải lại
  video này."; nhánh cuối chỉ nói "không khả dụng" khi đúng là `unavailable`, còn lại "Không tải được video này vì một lỗi
  không xác định do công cụ tải (yt-dlp) báo về …".
- Nhãn nguyên nhân (Nhật ký / Chẩn đoán) và câu khi hết lượt thử cho `interrupted`.
- Tác vụ thử lại nằm ở `retry_wait`; lúc mở app được giữ ở "dở dang" như mọi tác vụ đang chờ thử lại.

## Kiểm tra

- Unit `ytdlp-killed-classification.test.ts`: nguyên văn đầu ra yt-dlp bị giết → `interrupted` thử lại được; đầu ra rỗng;
  `ERROR:` lạ → `unknown`; Traceback → `unknown`; các loại đã nhận ra giữ nguyên. Mã cũ: đỏ 2/5.
- Integration `ytdlp-killed-download-error.test.ts` (DownloadEngine.run() thật, CSDL thật, chỉ giả tiến trình yt-dlp): bị giết
  → `DOWNLOAD_FAILED` thử lại được, câu "dừng đột ngột"; `ERROR:` lạ → không thử lại, "không xác định"; video thật sự không
  khả dụng → vẫn báo đúng. Mã cũ: đỏ 2/3.
- Sau khi sửa, cùng phép thử (2 lõi, chạy riêng bài e2e "Khởi động…", gắn log đọc CSDL): **12/12 xanh**. Lượt 8 vẫn
  trúng tranh chấp (yt-dlp bị giết trước) nhưng tác vụ là `retrying` · "Tiến trình tải bị dừng đột ngột…" thay vì `failed` ·
  "Video không khả dụng"; mở lại app được giữ đúng ở `paused` / `APP_INTERRUPTED`.
