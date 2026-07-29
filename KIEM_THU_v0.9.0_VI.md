# Biên bản kiểm tra Tubmedia v0.9.0

## Phạm vi sửa

- Source update giải nén trực tiếp vào thư mục source cũ, không tạo thư mục bọc theo phiên bản.
- Installer giữ một app ID/khóa Registry và cập nhật đúng `InstallLocation` cũ.
- Tải & Ghép không còn dùng cấu hình CapCut/bitrate toàn cục để làm giảm chất lượng video nguồn.
- Nguồn/cache được tách theo từng project/lane; cùng một link trong Tải danh sách và Tải & Ghép tạo hai nguồn độc lập.
- Giao diện Cài đặt tách riêng mục Tải danh sách và Tải & Ghép, không dùng chung giới hạn đầu ra.
- Cache ghép cũ chưa có dấu nguồn tốt nhất được tải lại.
- Giao diện không chờ health check, sửa công cụ, log cũ và PowerShell dò phần cứng mới được mở.

## Kiểm tra bắt buộc

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run dev
```

## Kiểm tra thực tế trên Windows

1. Mở app và xác nhận giao diện xuất hiện trước khi toàn bộ công cụ kiểm tra xong.
2. Mở **Tải & Ghép**, dùng một video từng tải hơn 500 MB và xác nhận nguồn mới không bị chế độ CapCut/giới hạn bitrate làm giảm còn khoảng 200 MB.
3. Xác nhận giao diện ghi rõ video nguồn tải chất lượng cao nhất và lựa chọn chất lượng chỉ áp dụng cho thành phẩm.
4. Dán cùng một link vào Tải danh sách và Tải & Ghép, xác nhận hai chức năng dùng tên/chính sách cache riêng và không nhận nhầm tệp của nhau.
5. Mở Cài đặt, xác nhận hai mục **Tải danh sách** và **Tải & Ghép** hiển thị tách biệt.
6. Build installer bằng `npm.cmd run dist`, chạy trên máy đã cài bản cũ và xác nhận không xuất hiện trang chọn thư mục; bản mới nằm đúng `InstallLocation` cũ.
7. Chạy `npm.cmd run dist:source-update`, mở ZIP và xác nhận `package.json` nằm ngay ở gốc.

Project, setting, history và database phải được giữ nguyên qua nâng cấp.
