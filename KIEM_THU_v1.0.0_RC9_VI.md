# KIỂM THỬ TUBMEDIA 1.0.0-RC.9

1. Cài installer được build bằng `dist:nsis-safe` rồi mở Trung tâm cập nhật.
2. Bấm **Kiểm tra ngay**: khi chưa có máy chủ cập nhật, kết quả phải hiện gần như tức thì: `Bản cài thử này chưa được liên kết với máy chủ cập nhật.`
3. Không được giữ vòng xoay `Đang kiểm tra` vô thời hạn.
4. Với URL máy chủ không phản hồi, kiểm tra thủ công phải kết thúc trong khoảng 8 giây; kiểm tra nền trong khoảng 5 giây.
5. Bấm liên tiếp nhiều lần không được tạo nhiều lượt yêu cầu trùng nhau.
6. Khi build bằng `release:windows` có `app-update.yml`, kiểm tra cập nhật vẫn hoạt động bình thường.
