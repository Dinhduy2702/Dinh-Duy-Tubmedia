# Quality Profiles

- **Nguyên bản H.264/AAC · giữ gần dung lượng nguồn — KHUYÊN DÙNG**: Tải & Ghép ưu tiên AVC1/H.264 + M4A/AAC lớn nhất như code tham chiếu; không chuyển mã sau tải. Video tương thích được concat bằng stream copy. Video bắt buộc chuẩn hóa dùng bitrate suy ra từ dung lượng thật của chính video đó.
- **Chất lượng cao nhất theo nguồn**: giữ độ phân giải/FPS/HDR cao nhất khi có thể, nhưng codec nguồn có thể là VP9/AV1 và dung lượng nhỏ hơn H.264 dù chất lượng hình không thấp hơn.
- **Ghép thông minh chất lượng cao nhất**: phân tích toàn bộ, chuẩn hóa file lệch chuẩn rồi concat copy.
- **1080p cố định · mã hóa lại CRF 18**: 1920×1080, 30 FPS, libx264 CRF 18, preset veryfast, yuv420p SDR BT.709. Cấu hình này mã hóa lại nên có thể làm video 500 MB còn khoảng 200 MB; chỉ dùng khi cần cố định chuẩn hình cho CapCut.
- **1080p Compatible**: tối đa 1920×1080, H.264/AAC 48 kHz, không upscale mặc định.
- **Smooth Background**: giới hạn tài nguyên, ưu tiên phản hồi Windows.
- **Maximum CPU Quality**: libx264 CRF thấp, một worker và Below Normal priority.

Upscale không tạo thêm chi tiết thật.

## Thiết lập khuyến nghị để giữ giống code tham chiếu

- Chất lượng thành phẩm: **Nguyên bản H.264/AAC · giữ gần dung lượng nguồn**.
- Cấu hình hiệu năng: **Tương tác mượt** hoặc cấu hình ứng dụng tự khuyến nghị.
- Không chọn **1080p cố định · mã hóa lại CRF 18** khi mục tiêu là giữ dung lượng gần nguồn.
- Preset khuyên dùng cho Tải danh sách là 720p–1080p H.264/MP4; chọn **Nguồn cao nhất** khi cần 2K/4K, HDR, FPS hoặc bitrate tối đa.
- Giữ `aria2c` bật; aria2c chỉ tăng tốc tải và không làm giảm chất lượng.
