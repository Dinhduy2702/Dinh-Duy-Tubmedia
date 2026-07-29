# Tubmedia 1.2.0 – Bản cập nhật tổng hợp hoàn chỉnh

Bản 1.2.0 kế thừa toàn bộ sửa lỗi 1.0.1 và 1.1.0, đồng thời tối ưu sâu pipeline ghép, bộ cài, cập nhật ứng dụng và giao diện.

## 1. Ghép và chuẩn hóa thông minh

1. FFprobe phân tích nhiều nguồn song song.
2. Nguồn đã tương thích được concat bằng stream copy, không mã hóa lại.
3. Nếu chỉ khác container hoặc timestamp, Tubmedia remux sang MP4 bằng stream copy.
4. Chỉ clip lệch codec, kích thước, FPS, pixel format hoặc âm thanh mới bị chuẩn hóa.
5. Chuẩn hóa và remux chạy song song theo giới hạn tài nguyên.
6. Tệp chuẩn hóa/remux hợp lệ được cache theo dấu vân tay nguồn, target và profile.
7. Tự dùng NVENC khi FFmpeg xác minh encoder; nếu GPU lỗi ở runtime thì thử lại bằng CPU.
8. Giữ đúng tỷ lệ khung hình, SAR 1:1, scale-to-fill và crop cân giữa; không tự thêm viền đen.
9. Ghép cuối bằng stream copy để tránh mã hóa lần hai.

## 2. Tiến trình và thao tác

- Không hiển thị Unknown B/s, NaN, undefined hoặc null.
- Trạng thái hoàn tất ghi đè trạng thái trung gian cũ.
- Tác vụ đang chạy lên đầu, đang chờ phía sau, hoàn tất xuống cuối.
- Tất cả hàng đều có icon xóa cố định.
- Hộp xóa có hai lựa chọn: chỉ xóa khỏi danh sách hoặc xóa cả tệp đầu ra.
- Backend chỉ được phép xóa đúng một tệp đầu ra, không được xóa cả thư mục.
- Có chevron xoay mượt và các thanh tiến trình con khi mở rộng.
- Tên video, đường dẫn và mã kỹ thuật được tinh gọn bằng ellipsis, tooltip và phần chi tiết.

## 3. Danh sách, quy trình và responsive

- Mỗi danh sách tải/quy trình ghép có tab riêng, không nối dài tất cả nội dung vào một vùng.
- Chuyển tab không làm dừng tác vụ nền.
- Danh sách/quy trình mới kế thừa đường dẫn gần nhất.
- Đường dẫn được lưu bền vững và kiểm tra quyền ghi.
- Sidebar, bảng tiến trình, thanh công cụ và thẻ thông tin có min/max hợp lý.
- Trên cửa sổ hẹp ưu tiên icon; tooltip/popover cung cấp thông tin chi tiết.

## 4. Bộ công cụ

- Build bắt buộc kiểm tra yt-dlp, FFmpeg và FFprobe có trong payload cài đặt.
- Mỗi công cụ được chạy lệnh version trước khi NSIS được phép tạo installer.
- Không thể phát hành thành công nếu thiếu một công cụ bắt buộc.
- Giao diện hiển thị riêng phiên bản và chỉ hiện nút Cập nhật khi thực sự có bản mới.

## 5. Bộ cài và cập nhật ứng dụng

- NSIS tự đóng tiến trình Tubmedia cũ trước khi ghi đè, tránh lỗi “Error opening file for writing”.
- Giữ nguyên appId, registry key và thư mục cài đặt để cập nhật tại chỗ.
- `app-update.yml` được đóng gói vào resources.
- Build chính thức tạo `latest.yml` với SHA-512, kích thước installer và ngày phát hành.
- Khi updater gọi installer với `--force-run`, installer có thể mở lại ứng dụng sau khi cài.
- GitHub Release phải chứa cùng lúc installer EXE, file SHA-256 và `latest.yml`.

## 6. Nhận diện trong ứng dụng

- Thẻ “Phát triển bởi Đình Duy · Tubmedia” được thiết kế lại bằng component và CSS responsive.
- Icon play, tên nhà phát triển, tên sản phẩm và tagline được tách cấp bậc rõ ràng.
- Không còn chữ dính, chồng hoặc co méo khi sidebar thu nhỏ.

## Kiểm thử Windows bắt buộc

Chạy `BUILD_INSTALLER_CHINH_THUC.ps1`. Script phải vượt qua verify, typecheck, lint, unit test, integration test, kiểm tra đủ công cụ và build NSIS. Chỉ phát hành khi PowerShell hiện `OFFICIAL INSTALLER READY`.
