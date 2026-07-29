# Tubmedia 1.2.0 FIX11

## Sửa lỗi

- `JOB_RETRY_SCHEDULED` và `COOKIE_RETRY_SCHEDULED` là trạng thái tự thử lại, không còn chiếm Trung tâm lỗi cố định.
- Lỗi thật sau khi hết số lần thử vẫn hiện bằng `JOB_FAILED` với chi tiết đầy đủ.
- Không gọi `mkdir` trên ổ gốc Windows đã tồn tại, tránh `EPERM: operation not permitted, mkdir 'E:\'`.
- Hộp chọn thư mục mở lại đúng đường dẫn hiện tại của trường.
- Ghi nhớ đường dẫn tải, tạm, nguồn ghép và thành phẩm trong dữ liệu giao diện.
- Danh sách/quy trình mới kế thừa đường dẫn người dùng chọn gần nhất thay vì quay lại Downloads.
