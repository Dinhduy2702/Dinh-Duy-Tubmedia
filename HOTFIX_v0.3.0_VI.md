# Video Studio Pro v0.3.0 — Dynamic Lists, Quality Guardrails & Full Verification

## Mục tiêu

Bản này hoàn thiện workflow tải video theo hướng ứng dụng desktop chuyên nghiệp:

- Người dùng mở linh động 1, 2, 3 hoặc 4 danh sách tải.
- Mỗi danh sách có output, temp, queue, trạng thái, lỗi và nhật ký riêng.
- Scheduler chia worker công bằng giữa các danh sách và vẫn tôn trọng giới hạn tổng toàn ứng dụng.
- Chất lượng tải được đặt tối thiểu/tối đa ngay trên giao diện.
- Có lựa chọn giải mã và kiểm tra toàn bộ file từ đầu đến cuối sau khi tải.
- Khi video yêu cầu cookies, chỉ danh sách liên quan bị Pause và giao diện hiện nút xử lý trực tiếp.

## Chất lượng tải có thể cấu hình

Trang `Cài đặt > Tải xuống` cho phép đặt:

- Độ phân giải tối thiểu và tối đa.
- FPS tối thiểu và tối đa.
- Video bitrate tối thiểu và tối đa.
- Audio bitrate tối thiểu và tối đa.
- Codec ưu tiên: Auto, H.264, HEVC, VP9 hoặc AV1.
- Container: Auto, MP4 hoặc MKV.
- Cho phép hoặc không cho phép fallback xuống dưới mức tối thiểu.
- Kiểm tra toàn bộ video bằng FFmpeg sau khi tải.

Giá trị `0` nghĩa là không giới hạn ở phía tương ứng. Backend kiểm tra lại file thật bằng ffprobe sau tải; không chỉ tin metadata của nền tảng.

## Kiểm tra file tải về

Pipeline xác minh gồm:

1. Kiểm tra file tồn tại và đọc được.
2. ffprobe xác nhận video stream, thời lượng, dung lượng, độ phân giải, FPS, codec, bitrate và audio.
3. Fast verification trước khi remux.
4. Deep verification tùy chọn: FFmpeg giải mã toàn bộ video và audio từ đầu đến cuối.
5. Kiểm tra lại giới hạn chất lượng đã đặt.
6. File lỗi hoặc không đạt giới hạn bắt buộc được chuyển vào quarantine, không giả vờ hoàn tất.
7. File được copy/hard-link sang thư mục list khác cũng được kiểm tra nhanh sau khi tạo.

## Cookies

Cookies có thể cấu hình tại:

- `Cài đặt > Tải xuống > Cookies và đăng nhập`.
- Khối Preflight tại màn hình tải.
- Thẻ cảnh báo của đúng danh sách khi yt-dlp yêu cầu đăng nhập.

Hỗ trợ:

- File `cookies.txt` định dạng Netscape.
- Cookies từ Chrome.
- Cookies từ Edge.
- Cookies từ Firefox.

Khi có lỗi xác thực, queue của danh sách đó Pause, các danh sách khác tiếp tục chạy. Sau khi thêm cookies, ứng dụng retry và resume đúng list.

## Nhật ký và xử lý sự cố

- Mỗi project/list được ghi thêm file riêng tại `logs/projects/<projectId>.log`.
- Mỗi thẻ danh sách chỉ hiển thị log của danh sách đó.
- Trang Nhật ký có bộ lọc theo danh sách, mức log và module.
- Thông tin cookies, token, password và authorization được che trước khi ghi log.
- Diagnostic bundle chứa log, cấu hình đã làm sạch, cấu hình máy, tool, project và job.
- Lỗi tool, cookies, hết dung lượng hoặc quyền thư mục sẽ Pause list thay vì tạo hàng loạt job lỗi.
- Ba lỗi mạng/CDN liên tiếp trong cửa sổ hai phút sẽ mở circuit breaker và Pause riêng list đó.

## Khuyến nghị tài nguyên

Ứng dụng đọc CPU, RAM, GPU và loại ổ đĩa rồi tạo kế hoạch cho 1–4 list. Khi bật Deep verification, giới hạn tổng worker được tự giảm vì FFmpeg phải đọc và giải mã toàn bộ file.

Đối với máy workstation 72 logical CPU và 128 GB RAM:

- 1 list: 4 worker bình thường; khoảng 3 worker khi Deep.
- 2 list: 2 worker/list, tổng 4 bình thường; tổng khoảng 3 khi Deep.
- 3 list: 1 worker/list, tổng 4 bình thường; tổng khoảng 2 khi Deep.
- 4 list: 1 worker/list, tổng 4 bình thường; tổng khoảng 2 khi Deep.

Nên đặt temp trên SSD và output trên HDD. Chỉ tăng 6–8 worker tổng khi mạng ổn định và ổ lưu không đạt 100% Active Time.
