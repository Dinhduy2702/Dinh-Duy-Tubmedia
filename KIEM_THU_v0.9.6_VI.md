# KIỂM THỬ TUBMEDIA v0.9.6

## Sửa lỗi Google Drive
- Không còn ép `yt-dlp -f source` cho Tải & Ghép.
- Khớp code tham chiếu: để yt-dlp tự chọn tệp mặc định/nguyên bản từ liên kết.
- Hỗ trợ cả link chia sẻ Google Drive và link tải trực tiếp/generic.
- Tải danh sách vẫn độc lập với Tải & Ghép.
- Cache policy mới `merge-google-drive-native-download-v6` buộc bỏ cache sai từ v0.9.5.

## Tối ưu tốc độ
- Google Drive không dùng aria2c; dùng downloader nội bộ yt-dlp giống code tham chiếu.
- Profile khuyên dùng đổi preset từ `slow` sang `veryfast`.
- Audio được stream-copy khi tương thích.
- Bước concat cuối vẫn `ffmpeg -c copy`.
