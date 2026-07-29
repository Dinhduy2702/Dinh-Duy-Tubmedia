# KIỂM THỬ TUBMEDIA v0.9.3 – GIỮ CHẤT LƯỢNG VÀ DUNG LƯỢNG NGUỒN

## Sửa chính
- Tải & Ghép ưu tiên video-only AVC1/H.264 + audio M4A/AAC như code tham chiếu.
- Không dùng lại cache từ chính sách cũ; video cũ sẽ được chuyển tạm vào khu cách ly rồi tải lại nguồn đúng chuẩn.
- Tệp sau tải không bị mã hóa lại. MP4 chỉ được remux bằng stream copy.
- Khi các video không tương thích để concat, bitrate mã hóa được suy ra từ dung lượng thật của từng video, không còn lấy một bitrate trung bình thấp áp lên tất cả.
- Thành phẩm cuối vẫn ghép bằng `ffmpeg -c copy` sau khi các nguồn đã tương thích.

## Cấu hình khuyên dùng
- Chất lượng thành phẩm: `Nguyên bản H.264/AAC · giữ gần dung lượng nguồn`.
- Cấu hình hiệu năng: `Tương tác mượt` hoặc cấu hình ứng dụng tự khuyến nghị cho máy.
- Không chọn `1080p cố định · mã hóa lại CRF 18` khi mục tiêu là giữ dung lượng gần nguồn.
- Tải danh sách: để Codec `Tự động`, giới hạn độ phân giải/FPS/bitrate bằng 0 nếu muốn chất lượng cao nhất.

## Kiểm tra ca 500 MB
1. Xóa tiến trình cũ rồi chạy lại cùng URL trong Tải & Ghép.
2. Nhật ký phải có `DOWNLOAD_FORMAT_CONFIRMED` và tên file chứa `[Nguon-chat-luong-cao]`.
3. Video nguồn mới phải ưu tiên H.264/AAC và có dung lượng gần bản tải bằng code tham chiếu.
4. Thành phẩm không được nhỏ hơn 75% tổng dung lượng video đã chuẩn bị; nếu thấp hơn, Tubmedia phải chặn và đưa vào khu cách ly.
