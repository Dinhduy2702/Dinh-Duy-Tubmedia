# Biên bản kiểm tra Tubmedia v0.8.3

## Lỗi và yêu cầu đã xử lý

- Tên video tiếng Việt từ yt-dlp bị lỗi thành `T�m Em, Kh�ng Bu�ng...`.
- Tác vụ cũ vẫn hiện “Thiếu công cụ xử lý video” dù Trung tâm công cụ đã báo Sẵn sàng.
- Video đã tải hợp lệ được dùng lại nhưng giao diện chưa nói rõ là đã bỏ qua.
- Màn hình danh sách có quá nhiều thanh tiến trình từng video.

## Hành vi mới cần xác nhận trên Windows

1. Khi mở ứng dụng, yt-dlp, FFmpeg và ffprobe được tự kiểm tra.
2. Tác vụ cũ chỉ bị chặn vì công cụ được tự đưa về hàng chờ sau khi công cụ sẵn sàng.
3. Tên tiếng Việt hiển thị đúng dấu ở trang Tiến trình và tên tệp.
4. Lần tải đầu tạo video theo ID nguồn và kiểm tra tệp.
5. Chạy lại đúng link: tệp được kiểm tra, không tải lại và dòng tiến trình hiện `Đã tải trước đó – đã bỏ qua`.
6. Hai video khác link/ID nhưng trùng tiêu đề vẫn tạo hai tác vụ/tệp riêng.
7. Tệp có sẵn nhưng hỏng hoặc tải dở không được bỏ qua; ứng dụng chuyển nó vào khu cách ly rồi tải lại.
8. Mỗi danh sách chỉ có một thanh tiến trình tổng.
9. Trang Tiến trình hiển thị đầy đủ từng video song song: tên, trạng thái, phần trăm, tốc độ/ETA, thông báo và đường dẫn.

## Cách chạy

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.3_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Chưa tạo installer trong vòng kiểm tra source này.
