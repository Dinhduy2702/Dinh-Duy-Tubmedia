# Download video Tubmedia v0.6.3

## Mục tiêu

Bản cập nhật này xử lý đồng thời các vấn đề về tự động kết nối công cụ, Việt hóa giao diện, lưu bền vững dữ liệu, điều khiển toàn ứng dụng và lỗi lặp `queue:remove`.

## Thay đổi chính

### 1. Tự động kết nối công cụ khi mở ứng dụng

- yt-dlp, FFmpeg, ffprobe, ffplay và aria2c được dò tìm và kiểm tra tự động trong quá trình khởi động.
- Giao diện chờ kết quả kiểm tra thật trước khi hiển thị trạng thái sẵn sàng.
- Nút **Kiểm tra lại** vẫn được giữ làm thao tác thủ công dự phòng, nhưng không còn bắt buộc.
- Trạng thái công cụ được gửi tự động tới mọi màn hình dùng chung.

### 2. Điều khiển tất cả danh sách tải và quy trình ghép

- **Tạm dừng tất cả** áp dụng cho mọi tác vụ tải, phân tích, kiểm tra, chuẩn hóa và ghép.
- **Tiếp tục tất cả** khôi phục toàn bộ tác vụ đã tạm dừng hoặc bị gián đoạn.
- Cùng một cơ chế được dùng ở thanh trên cùng và trang **Tiến trình**.
- **Dừng và xóa toàn bộ danh sách** hủy an toàn tiến trình nền rồi xóa toàn bộ danh sách tải, quy trình ghép, liên kết, tiến trình và nhật ký khỏi cơ sở dữ liệu.
- Video nguồn, video đã tải và thành phẩm trên ổ đĩa không bị xóa.

### 3. Dữ liệu được ghi đè và xóa bền vững

- Tên, liên kết, thư mục, cấu hình chất lượng và cấu hình tài nguyên được tự động lưu sau khi thay đổi.
- Chế độ nhập thay thế xóa cả mục cũ và lô nhập cũ trước khi ghi dữ liệu mới.
- Khi xóa một khu vực, ứng dụng xóa cả các bản ghi trùng mã còn sót từ phiên bản cũ.
- Khi xóa toàn bộ, ứng dụng xóa cả dự án đang hoạt động, bị ẩn, đã lưu trữ và bản ghi cũ.
- Cơ chế số phiên bản thay đổi và dấu xóa ngăn một lần tự động lưu cũ tạo lại danh sách vừa bị xóa.

### 4. Không còn spam lỗi `queue:remove`

- Dòng tiến trình chưa kết thúc hoặc còn phụ thuộc được bảo vệ bằng kết quả `false` thay vì ném lỗi IPC.
- Giao diện hiển thị cảnh báo dễ hiểu một lần.
- Dòng tiến trình chỉ được xóa riêng khi toàn bộ tác vụ liên quan đã kết thúc.

### 5. Việt hóa

- Tên trạng thái, loại tác vụ, nguồn công cụ, nút điều khiển, thông báo, lỗi, trang cài đặt, trang công cụ, hàng đợi và trình cài đặt đã được Việt hóa.
- Tên cấu hình tích hợp và tên thư mục mặc định cho cài đặt mới cũng được chuyển sang tiếng Việt.
- Tên kỹ thuật bắt buộc như yt-dlp, FFmpeg, H.264, HEVC, AAC, CPU, GPU và URL vẫn được giữ nguyên.

### 6. Cookies chỉ dùng khi cần

- Mở ứng dụng không tự đọc cookies và không tự mở thông báo cookies.
- Lần tải đầu của video luôn thử ở chế độ công khai.
- Chỉ khi yt-dlp xác nhận video cần đăng nhập, ứng dụng mới thử cookies đã lưu hoặc yêu cầu người dùng thêm cookies.
- Lỗi khóa dữ liệu Chrome/Edge chỉ được kiểm tra ở thời điểm video thực sự cần cookies.

## Phiên bản

- Ứng dụng: `0.6.3`
- Tên: `Download video Tubmedia`
- Nhà phát triển: `Đình Duy Tubmedia`
