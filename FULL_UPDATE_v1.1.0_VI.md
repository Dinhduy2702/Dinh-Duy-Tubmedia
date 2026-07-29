# Tubmedia 1.1.0 – Bản cập nhật tổng hợp

Bản này gom các sửa lỗi giao diện, tiến trình, cập nhật công cụ, cập nhật ứng dụng và xử lý song song.

## Đã triển khai
- Giữ đúng tỷ lệ video khi ghép, không tự thu nhỏ và pad viền đen với video cùng tỷ lệ.
- Đồng bộ trạng thái hoàn tất, không giữ “Đang kiểm tra tệp”.
- Lọc tốc độ rác và dùng dấu — khi chưa có dữ liệu hợp lệ.
- Sắp xếp tiến trình: đang chạy, đang chờ, cần xử lý, hoàn tất.
- Mỗi hàng tiến trình có nút xóa và nút mở rộng chi tiết.
- Danh sách tải và quy trình ghép chuyển sang giao diện tab, mỗi lần chỉ hiển thị một khu vực.
- Danh sách/quy trình mới kế thừa đường dẫn và cấu hình gần nhất.
- Hiển thị tên/đường dẫn rút gọn, chi tiết đầy đủ trong tooltip và vùng mở rộng.
- Công cụ chỉ hiện nút cập nhật khi kiểm tra thấy bản mới; khi mới nhất hiển thị version + “Mới nhất”.
- Cấu hình GitHub updater để electron-builder tạo app-update.yml/latest.yml/blockmap cho các bản sau.
- Cho phép nhiều quy trình ghép đồng thời theo maxGlobalMergeJobs, mỗi dự án vẫn có một merge job riêng.
- Bổ sung responsive min/max và vùng cuộn để tránh vỡ giao diện.

## Kiểm thử bắt buộc
- Cài trên tài khoản Windows sạch.
- Xác minh yt-dlp, ffmpeg, ffprobe đều được tự sửa/tải khi thiếu.
- Kiểm tra nâng cấp từ 1.0.1 lên 1.1.0 khi ứng dụng đã đóng.
- Ghép lại bộ video từng bị viền đen.
