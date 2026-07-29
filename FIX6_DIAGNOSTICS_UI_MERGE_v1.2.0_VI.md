# Tubmedia 1.2.0 FIX6 — Chẩn đoán, giao diện và ghép video

- Lỗi mới nhất luôn hiển thị tại Trung tâm lỗi cố định, có mã sự kiện, sao chép kỹ thuật và mở Nhật ký.
- Lỗi pending/quarantine hiển thị nguyên nhân xác minh chính xác; ffprobe kiểm tra từng điểm và FFmpeg giải mã dự phòng.
- Xác minh thành phẩm được thử lại sau khi tệp hoàn tất flush để giảm quarantine nhầm.
- GitHub API 403 đã có đường tải trực tiếp thì chỉ là thông tin, không phải cảnh báo.
- Cập nhật ứng dụng chạy thủ công; không còn biểu tượng cập nhật xoay nền.
- Cookies chỉ cảnh báo sau khi người dùng bấm tải và tác vụ thật sự cần xác thực; lưu thành công không spam thông báo.
- Trạng thái dùng màu riêng; mục Mức xử lý song song xanh khi hợp lý.
- Cấu hình thư mục/hiệu năng gọn thành 1–2 hàng; thanh cuộn con chỉ hiện khi hover.

## Kiểm thử Windows

Chạy typecheck, ESLint, unit test, integration test và ghép lại đúng quy trình từng tạo lỗi pending trước khi đóng installer.
