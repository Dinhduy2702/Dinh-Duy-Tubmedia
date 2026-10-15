# FIX22 — yt-dlp không còn để sót thư mục _MEI* trong %TEMP% khi bị dừng ngang

## Vì sao

2026-10-15: %TEMP% máy dev có 980 thư mục `_MEI*` = 21,4 GB, ổ C chỉ còn 4,4 GB nên hồ sơ "Toàn bộ hiệu năng" tạm dừng
mọi video với `DISK_FULL`. Người dùng thật cũng tích dần như vậy.

- `yt-dlp.exe` bản Windows là PyInstaller một tệp: tiến trình mồi giải nén ~20 MB vào `%TEMP%\_MEIxxxx` và chỉ tự xóa khi
  thoát bình thường.
- Tubmedia dừng yt-dlp bằng `taskkill /T /F` (tạm dừng, hủy, quá giờ, đóng app, kiểm tra công cụ quá giờ) → tiến trình mồi
  bị giết, thư mục bị bỏ lại.
- Đo thật bằng `tool/yt-dlp.exe`: thoát bình thường không sót; bị `taskkill /T /F` sót đúng 1 thư mục. Đặt `TMP`/`TEMP`
  cho tiến trình thì thư mục giải nén nằm đúng nơi chỉ định.

## Sửa

- `src/main/processes/ytdlp-runtime-temp.ts`: mỗi tiến trình yt-dlp một thư mục tạm riêng
  `%TEMP%\tubmedia-ytdlp-runtime\<mã>` (đặt `TMP` + `TEMP`), xóa khi tiến trình kết thúc dù thoát kiểu gì (thử lại tới
  10 lần × 200 ms vì tệp có thể còn bị khóa giây lát). Không bao giờ xóa thư mục của một yt-dlp khác đang chạy.
- `ProcessManager.run`: nhận yt-dlp theo TÊN TỆP CHẠY (phủ cả tải, Tải nhanh, kiểm tra sức khỏe công cụ, kiểm bản cập
  nhật), không theo tên `tool`.
- `VideoLinkFilterService` (tự spawn yt-dlp): cùng cơ chế; xóa ở sự kiện `close`/`error` của tiến trình (không phải lúc
  trả kết quả — khi quá giờ nó kill rồi trả ngay).
- Dọn thư mục KHÔNG còn ai dùng (`sweepUnused`): lúc khởi động app và sau mỗi lần một yt-dlp kết thúc (tối đa 1 lần/phút).
  Nhận biết bằng cách đổi tên thư mục: trên Windows thư mục có DLL đang được nạp (yt-dlp còn chạy) đổi tên báo `EPERM`
  (đo thật), nên chỉ thư mục đã bỏ mới bị xóa; thư mục vừa cấp chưa đủ 1 phút cũng được giữ. Nhờ vậy thư mục sót khi
  người dùng tắt app giữa lúc tải được dọn ngay lần mở app sau. Log `YTDLP_RUNTIME_TEMP_CLEANED`.
- Thư mục `_MEI*` đã sót từ bản cũ trong `%TEMP%` vẫn dọn được bằng Dọn dẹp máy (đã quét %TEMP%).

## Kiểm tra

- Integration `ytdlp-mei-temp-cleanup.test.ts` (yt-dlp thật): bị hủy giữa chừng → `_MEI` xuất hiện trong thư mục riêng
  rồi bị xóa sạch; thoát bình thường → không còn gì. Mã cũ: đỏ (yt-dlp giải nén vào %TEMP% chung).
- Integration: yt-dlp thật đang chạy (máy chủ cục bộ không trả lời) → `sweepUnused` KHÔNG đụng thư mục của nó, chỉ xóa
  thư mục sót; hủy xong thì sạch.
- Unit `ytdlp-runtime-temp.test.ts`: nhận diện tệp chạy, cấp/giải phóng thư mục riêng, dọn thư mục bị bỏ nhưng giữ thư
  mục vừa cấp.
- Lượt `npm run check` đầu (chưa có dọn thư mục bị bỏ): không `_MEI*` mới nào trong %TEMP% chung (165 → 165), nhưng còn
  23 thư mục (514 MB) trong thư mục riêng — các bài e2e đóng app khi yt-dlp đang chạy, app thoát trước khi kịp xóa. Đó là
  lý do thêm `sweepUnused`.
- Lượt `npm run check` sau khi thêm `sweepUnused`: %TEMP% chung vẫn 165 → 165; thư mục riêng 24 thư mục (514 MB) → 1
  (24 MB, của bài e2e cuối cùng đóng app khi yt-dlp đang chạy — dọn ở lần mở app kế tiếp). Unit 1342, integration 178 + 1
  bỏ qua, e2e 48/48.
