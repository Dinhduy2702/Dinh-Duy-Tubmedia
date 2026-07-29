# Biên bản kiểm tra Tubmedia v0.9.2

## Phạm vi sửa

- Trạng thái công cụ và các khuyến nghị bình thường mặc định chỉ chiếm một dòng.
- Các nút thao tác vẫn nằm ngoài phần chi tiết, không cần mở khối mới sử dụng được.
- Lỗi công cụ và cấu hình có nguy cơ giảm nét tự mở để user không bỏ sót cảnh báo quan trọng.
- Sidebar chỉ giữ biểu tượng và tên chức năng; logo nhà phát triển góc trái dưới vẫn giữ kích thước lớn của v0.9.1.
- Topbar chỉ còn số liệu và nút điều khiển dùng chung; không lặp lại tiêu đề, mô tả của trang.
- Mỗi quy trình ghép chỉ có một khu thông tin chất lượng thay cho ba thẻ cố định.
- Bố cục thanh thu gọn tự xếp lại ở cửa sổ hẹp mà không giấu nút Cookies, Công cụ hoặc Theo máy.

## Kiểm tra tự động

```powershell
npm.cmd install
npm.cmd run check
```

## Kiểm tra thực tế trên Windows

1. Giải nén gói cập nhật trực tiếp vào source cũ và chọn **Ghi đè tất cả**.
2. Mở **Tải nhiều danh sách**; xác nhận hai thanh Công cụ và Thiết lập tải đang thu gọn.
3. Bấm vào phần chữ của từng thanh để mở/đóng chi tiết; nút **Công cụ**, **Cookies** và **Theo máy** phải luôn sử dụng được.
4. Mở **Tải & Ghép**; xác nhận khuyến nghị song song và chất lượng mỗi sản phẩm không còn chiếm nhiều thẻ cố định.
5. Chọn cấu hình 720p; khu chất lượng phải tự mở và hiện cảnh báo có thể giảm nét.
6. Làm một công cụ bắt buộc không sẵn sàng trong môi trường thử; khu Công cụ phải tự mở và chỉ đường tới Trung tâm công cụ.
7. Thu nhỏ cửa sổ lần lượt dưới 900 px và 760 px; các nút không chồng chữ, không tràn khỏi thẻ và sidebar dưới vẫn dùng được.
8. Kiểm tra logo nhà phát triển góc trái dưới vẫn rõ, không bị thay đổi kích thước hoặc mất chữ ở cửa sổ rộng.
