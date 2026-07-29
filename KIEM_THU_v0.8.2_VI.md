# Biên bản kiểm tra Tubmedia v0.8.2

## Lỗi đã sửa

- Trang Công cụ có thể báo `yt-dlp`, FFmpeg và ffprobe sẵn sàng nhưng khu vực tải vẫn hiện “Thiếu công cụ xử lý video”.
- Hàng đợi khôi phục được chạy trước khi health check lúc khởi động hoàn tất.
- Health check lúc khởi động, kiểm tra cập nhật và kiểm tra trước khi tải có thể chạy trùng nhau.
- yt-dlp, ffprobe, ffplay và aria2c đã đọc được phiên bản nhưng giao diện vẫn hiện “Chưa nhận diện được khả năng của công cụ”.

## Logic mới

1. Ứng dụng dò và xác minh công cụ.
2. Nếu thiếu công cụ bắt buộc trên Windows x64, ứng dụng tự sửa và kiểm tra lại.
3. Chỉ sau bước trên, hàng đợi mới được khôi phục.
4. Cổng sẵn sàng tiếp tục chặn tác vụ nền nếu một trong ba công cụ bắt buộc chưa chạy được.
5. Mọi health check được xếp tuần tự; kết quả cũ và mới không ghi đè lẫn nhau.
6. Khi bấm tải, ứng dụng dùng kết quả còn mới và chỉ kiểm tra lại `yt-dlp`, `ffmpeg`, `ffprobe` khi cần.

## Kết quả mong đợi trên Windows

Trong Trung tâm công cụ:

- `yt-dlp`: hiển thị khả năng tải video, đọc thông tin liên kết, xuất tiến trình và kết nối FFmpeg khi lệnh trợ giúp xác nhận.
- `ffmpeg`: hiển thị codec, bộ lọc, ghép nối và định dạng như trước.
- `ffprobe`: hiển thị khả năng phân tích video, đọc luồng và xuất dữ liệu.
- `ffplay`: hiển thị khả năng phát/xem trước.
- `aria2c`: hiển thị khả năng tải dữ liệu và tải nhiều kết nối.

Nếu một lệnh trợ giúp phụ không trả dữ liệu nhưng executable và phiên bản đã xác minh, giao diện hiện:

```text
Đã xác nhận tệp thực thi và phiên bản.
```

## Cách kiểm tra sạch

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.2_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Sau khi giao diện mở:

1. Chờ trạng thái toàn ứng dụng là `Sẵn sàng tải và ghép`.
2. Vào Trung tâm công cụ, xác nhận yt-dlp, FFmpeg và ffprobe đều `Sẵn sàng`.
3. Trở lại Tải nhiều danh sách và thử một liên kết.
4. Xác nhận hàng đợi chuyển sang Phân tích/Tải xuống, có phần trăm, tốc độ và ETA.
5. Đợi quá 30 giây rồi thử danh sách khác; ứng dụng không được báo thiếu công cụ giả.
6. Đóng/mở lại khi còn tác vụ để xác nhận hàng đợi chỉ khôi phục sau bước kiểm tra công cụ.

Chưa tạo installer ở vòng kiểm tra source này.
