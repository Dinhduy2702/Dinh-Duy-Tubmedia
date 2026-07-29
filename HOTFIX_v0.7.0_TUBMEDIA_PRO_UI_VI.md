# Download video Tubmedia v0.7.0

## Nội dung chính

- Icon Tubmedia đỏ–trắng nền trong suốt, không viền đen.
- Giao diện mới theo hệ màu Tubmedia, hỗ trợ sáng/tối và tự đổi theo Windows.
- Sidebar gọn trên Desktop, tự chuyển thành thanh điều hướng dưới đáy khi cửa sổ hẹp.
- Các nhóm nút được phân cấp rõ: hành động chính, hỗ trợ và xóa dữ liệu.
- Animation mượt và tuân thủ cài đặt Giảm chuyển động của hệ điều hành.
- Tạm dừng/Tiếp tục thực sự điều khiển cây tiến trình yt-dlp/FFmpeg trên Windows.
- Xóa toàn bộ ghi trực tiếp vào SQLite và dọn cả dữ liệu cũ/ẩn.

## Tệp nhận diện

- `resources/icon.png`: biểu tượng 1024 × 1024 nền trong suốt.
- `resources/icon.ico`: icon Windows nhiều kích thước từ 16 đến 256 px.
- `src/renderer/public/tubmedia-app-icon.png`: icon dùng trong giao diện.

## Kiểm tra nhanh trên Windows

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run dist
```

Tệp cài đặt dự kiến:

```text
release\Download video Tubmedia-Setup-0.7.0-x64.exe
```
