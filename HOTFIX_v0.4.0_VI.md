# Video Download & Merge Studio Pro v0.4.0

## Mục tiêu bản cập nhật

Bản v0.4.0 thiết kế lại workflow theo hướng ứng dụng desktop chuyên nghiệp: mỗi danh sách tải và mỗi pipeline tải-ghép là một khu vực độc lập, có trạng thái, tiến trình, log và nút điều khiển riêng.

## 1–4 danh sách tải độc lập

- Người dùng chọn hiển thị 1, 2, 3 hoặc 4 danh sách.
- Mỗi danh sách có input link, output, temp, resource profile, worker, Start/Pause/Resume/Cancel riêng.
- Nút điều khiển thay đổi theo trạng thái; không hiển thị đồng thời Pause và Resume gây nhầm lẫn.
- Khi đang chạy hoặc tạm dừng, các trường có thể làm sai job hiện tại bị khóa.
- Scheduler chia công bằng giữa các danh sách và vẫn tuân thủ giới hạn worker toàn ứng dụng.
- Lỗi chặn chỉ tạm dừng đúng danh sách liên quan; danh sách khác tiếp tục.

## 1–4 pipeline tải và ghép độc lập

- Người dùng chọn 1–4 pipeline ghép.
- Mỗi pipeline nhận số link tùy ý, không giới hạn ở 2–4 video.
- Mỗi pipeline có thư mục, tên file, Quality Profile, Resource Profile, progress và log riêng.
- Có giới hạn số pipeline được phép chạy cùng lúc để tránh FFmpeg tranh CPU, GPU và ổ đĩa.
- Quality Profile có sẵn từ 720p đến 4K/Highest Source và hỗ trợ profile tùy chỉnh.

## Phản hồi thao tác và trung tâm cảnh báo

- Nút đang xử lý hiển thị spinner và nhãn như Đang chuẩn bị, Đang lưu, Đang mở, Đang áp dụng.
- Thao tác thành công hiển thị thông báo rõ ràng.
- Lỗi quan trọng hiển thị ở trung tâm màn hình, có tiêu đề, mô tả và các bước xử lý.
- Chi tiết kỹ thuật nằm trong vùng mở rộng, không đổ chuỗi lỗi thô lên giao diện chính.
- Cửa sổ ứng dụng được focus và flash khi có sự cố cần người dùng xử lý.

## Cookies: ba cách cấu hình

1. Lấy trực tiếp từ Chrome, Edge hoặc Firefox, có hỗ trợ profile.
2. Dán trực tiếp nội dung cookies.txt dạng Netscape.
3. Chọn file cookies.txt.

Khi Chrome/Edge khóa cơ sở dữ liệu cookies, ứng dụng chuyển lỗi kỹ thuật thành hướng dẫn: đóng hoàn toàn trình duyệt, dùng Firefox, dán trực tiếp hoặc chọn file TXT. Queue liên quan được tạm dừng an toàn.

## Dọn tiến trình và nhật ký

- Mỗi danh sách/pipeline có nút xóa lịch sử tiến trình riêng.
- Mỗi danh sách/pipeline có nút xóa log riêng.
- Trang Nhật ký có thể lọc theo khu vực, xóa khu vực đang chọn hoặc xóa toàn bộ.
- Không cho xóa trạng thái đang chạy để tránh mất khả năng theo dõi job.

## Giao diện desktop

- Gỡ menu native File/Edit/View/Window khỏi cửa sổ production.
- Bổ sung animation, trạng thái hover/active/loading, attention overlay và responsive layout.
- Tôn trọng Reduce Motion của Windows.
- Các control không có tác dụng đã được loại bỏ hoặc nối với backend/IPC thật.

## Cài đặt chất lượng

### Tải về

- Min/max resolution, FPS, video bitrate, audio bitrate.
- Ưu tiên H.264, HEVC, VP9, AV1 hoặc Auto.
- MP4/MKV/Auto.
- Strict minimum hoặc fallback khi nguồn không đủ.
- ffprobe validation và tùy chọn Deep Verify toàn bộ file bằng FFmpeg.

### Ghép/xuất

- Quality Profile 720p, 1080p, 1440p, 4K, Highest Source, Smart Merge.
- Custom width/height/FPS, codec, encoder, CRF/CQ, preset, HDR, audio và sample rate.
- Stream copy khi tương thích; chỉ normalize nguồn lệch chuẩn.
