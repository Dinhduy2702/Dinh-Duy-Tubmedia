# KIỂM THỬ TUBMEDIA v1.0.0 RC7

## Mục tiêu

RC7 ổn định chiều cao và chiều rộng của bảng Tiến trình/Nhật ký. Nội dung dài không được làm hàng cao lên, xuống dòng hoặc phá bố cục khi thu nhỏ cửa sổ.

## Các thay đổi cần kiểm tra

1. Cột Trạng thái có chiều rộng và chiều cao cố định; các nhãn như Hoàn tất, Đang tải, Đang chuẩn hóa không xuống dòng.
2. Cột Thông báo chỉ hiển thị tiêu đề ngắn và biểu tượng thông tin.
3. Rê chuột, focus bằng bàn phím hoặc bấm biểu tượng sẽ mở nội dung đầy đủ.
4. Bấm biểu tượng sẽ ghim cửa sổ chi tiết; bấm ra ngoài hoặc nhấn Escape sẽ đóng.
5. Nội dung “Đã tải nguồn tốt nhất…” chỉ nằm trong cửa sổ chi tiết, không kéo giãn hàng tiến trình.
6. Nhật ký toàn ứng dụng và nhật ký riêng đều hiển thị một dòng gọn; nội dung đầy đủ nằm trong cửa sổ chi tiết.
7. Khi thu nhỏ cửa sổ, bảng dùng cuộn ngang có kiểm soát thay vì ép cột xuống nhiều dòng.

## Lệnh kiểm tra

```powershell
npm.cmd run verify:release
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```

## Kiểm tra thủ công

- Mở trang Tiến trình khi có ít nhất một tác vụ đã hoàn tất.
- Rê chuột vào biểu tượng thông tin ở cột Thông báo.
- Bấm biểu tượng để ghim cửa sổ; cuộn bảng và thay đổi kích thước cửa sổ.
- Mở Nhật ký vận hành, kiểm tra dòng có đường dẫn dài hoặc lỗi kỹ thuật dài.
- Mở nhật ký riêng trong Danh sách tải và Tải & Ghép.
