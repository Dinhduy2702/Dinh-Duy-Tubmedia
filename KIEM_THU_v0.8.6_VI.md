# Biên bản kiểm tra Tubmedia v0.8.6

## Yêu cầu đã xử lý

- Phần ghép video có thanh tiến trình riêng và đầy đủ.
- Luồng tải danh sách và luồng tải–ghép dùng nhóm worker độc lập, có thể hoạt động đồng thời.
- Tải được tối ưu theo bản code tham chiếu mà vẫn giữ retry/fallback an toàn.
- Video yêu cầu cookies không còn làm đứng toàn bộ danh sách hoặc gán lỗi cho link chưa chạy.
- Cookies hết hạn, lỗi công cụ, mạng, dung lượng, quyền thư mục và lỗi ghép đều được thông báo cho user.
- Lỗi PID Windows 87 không còn tạo UnhandledPromiseRejection.
- Hỗ trợ dán cookies Netscape, JSON và chuỗi Cookie.

## Dữ liệu hiển thị trong tiến trình ghép

1. Giai đoạn hiện tại.
2. Phần trăm toàn tác vụ ghép.
3. Tốc độ FFmpeg theo hệ số `x` và FPS khi có.
4. Thời gian đã chạy.
5. Thời gian còn lại.
6. Thời lượng nội dung đã xử lý / tổng thời lượng.
7. Video hiện tại / tổng số video.
8. Đường dẫn thành phẩm và các tệp timeline sau khi hoàn tất.

## Kết quả kiểm tra tự động

- Asset: hợp lệ.
- TypeScript: đạt.
- ESLint: đạt, không có cảnh báo.
- Unit test: 83/83 đạt.
- SQLite integration: 10/10 đạt.
- Production build: đạt.

## Hành vi cần xác nhận trên Windows

1. Mở một danh sách tải và một quy trình tải–ghép, sau đó bắt đầu cả hai.
2. Xác nhận video nguồn của quy trình ghép vẫn tải khi danh sách tải đang dùng đủ worker.
3. Khi một video yêu cầu đăng nhập, chỉ dòng đó chuyển sang Tạm dừng; các link phía sau tiếp tục.
4. Dán cookies mới rồi xác nhận; hộp Cookies đóng và các dòng bị chặn quay lại hàng chờ.
5. Trong lúc ghép, xác nhận phần trăm, giai đoạn, tốc độ, thời gian đã chạy và ETA cập nhật.
6. Khi ghép xong, thanh đứng yên ở 100% và timeline được tạo.
7. Tạm dừng đúng lúc tiến trình vừa kết thúc không được xuất hiện `UnhandledPromiseRejectionWarning` hoặc lỗi PID 87.

## Cách chạy

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.6_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Chưa tạo installer trong vòng kiểm tra source này.
