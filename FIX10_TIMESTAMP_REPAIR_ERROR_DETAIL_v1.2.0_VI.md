# Tubmedia 1.2.0 FIX10 — Sửa timestamp ghép và khung chi tiết lỗi

## Lỗi thực tế được xử lý

Thành phẩm ghép có tổng thời lượng dự kiến khoảng `4004.15 giây` nhưng FFprobe đọc container thành `1507876.93 giây`. Đây không phải video dài 17 ngày; đó là metadata/timestamp đầu ra bị phóng đại do một hoặc nhiều nguồn mang `start_time`, edit-list hoặc mốc PTS/DTS bất thường.

## Luồng xử lý mới

1. Ghép nhanh bằng stream-copy như trước.
2. Kiểm tra thời lượng và mẫu đầu/giữa/cuối.
3. Nếu phát hiện thời lượng hoặc timestamp bất thường, chưa đưa file vào quarantine.
4. Remux từng nguồn bằng `-fflags +genpts -copyts -start_at_zero`, bỏ metadata/chapter không cần thiết và giữ nguyên codec.
5. Ghi duration chính xác vào concat list, ghép lại đúng một lần.
6. Xác minh lại hai lượt sau khi filesystem flush metadata.
7. Chỉ quarantine nếu bản đã sửa timestamp vẫn không hợp lệ.

## Chi tiết lỗi mới trong giao diện

Khi quy trình ghép thất bại, ngay trong thẻ quy trình xuất hiện phần **Chi tiết lỗi của quy trình** với:

- Thời gian lỗi.
- Mã lỗi ứng dụng.
- Mã sự kiện nhật ký.
- Job ID.
- Nội dung lỗi đầy đủ.
- JSON kỹ thuật có metadata, đường dẫn pending/quarantine và thông tin từng video nguồn.
- Nút **Sao chép chi tiết lỗi**.
- Nút **Mở nhật ký riêng**.

Khung này được giữ lại cho đến khi tác vụ được thử lại/xóa hoặc trạng thái lỗi thay đổi.
