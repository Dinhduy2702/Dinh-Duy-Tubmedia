# Biên bản kiểm tra Tubmedia v0.8.0

## Phạm vi đã kiểm tra

- Nhận diện ở loading, sidebar, trang Thông tin, chữ ký nhà phát triển, favicon, icon cửa sổ và icon Windows.
- Dò công cụ portable/managed/bundled/PATH và tự sửa yt-dlp, FFmpeg, ffprobe trên Windows x64.
- Luồng tải thật, lấy metadata, đặt tên tệp, đọc tiến trình yt-dlp, kiểm tra chất lượng và lưu đường dẫn đầu ra.
- Quan hệ phụ thuộc tải → cắt → chuẩn hóa → ghép; tạm dừng, tiếp tục, hủy, thử lại và khôi phục hàng đợi.
- Timeline TXT/CSV/JSON theo tên sản phẩm, thứ tự đầu vào và metadata trong SQLite.
- Responsive, reduced-motion, công tắc Sáng/Tối không tạo thông báo và thông báo thường tự ẩn.

## Kết quả tự động

- Asset PNG/ICO: đạt.
- TypeScript cho main/preload/renderer: đạt.
- ESLint với 0 cảnh báo: đạt.
- Unit test: 44/44 đạt.
- SQLite integration: 6/6 đạt.
- Electron production build: đạt.
- Logo SVG và favicon xuất hiện trong thư mục renderer sau build: đạt.

## Giới hạn môi trường kiểm tra

Máy kiểm tra nguồn là Linux bị chặn socket giao diện, vì vậy không thể mở cửa sổ Electron bằng Playwright. Các nhánh dành riêng cho Windows như tải/cài executable, PowerShell điều khiển cây tiến trình và tải video thật cần được chạy lại trên máy Windows của người dùng trước khi tạo installer.

## Kiểm tra trên Windows trước khi đóng gói

```powershell
npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Trong lần mở đầu, chờ màn hình loading tự kiểm tra và tải công cụ bắt buộc. Sau đó thử một URL công khai và xác nhận:

1. Thanh tiến trình từng video đổi từ Phân tích sang Đang tải.
2. Tên hàng đợi đổi sang tiêu đề video thật.
3. Phần trăm, tốc độ hoặc ETA cập nhật.
4. Tệp cuối có dạng `Tiêu đề video [ID].phần_mở_rộng`.
5. Quy trình ghép hiển thị thứ tự timeline và tạo đủ MP4/TXT/CSV/JSON.

Chỉ chạy `npm.cmd run dist` sau khi năm điểm trên đạt trên Windows.
