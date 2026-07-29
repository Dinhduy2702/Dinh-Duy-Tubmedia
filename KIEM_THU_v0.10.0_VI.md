# KIỂM THỬ TUBMEDIA v0.10.0

## Mục tiêu bản cập nhật

- Xuất timeline TXT bằng biểu tượng **Xuất TXT** và hộp thoại **Save As**.
- Giao diện Tải danh sách và Tải & Ghép gọn hơn; thông tin chi tiết được thu vào khối mở rộng.
- Tải đa nền tảng bằng yt-dlp, nhận diện và bỏ qua theo mã link thay vì tên video.
- Tự dọn `_normalized`, `_quarantine`, `_yt_tmp`, concat, pending và tệp tải dở.
- Thành phẩm MP4 nằm trực tiếp trong **Thư mục thành phẩm** mà user chọn.
- Preset Tải danh sách khuyên dùng bám workflow tham chiếu: H.264/MP4, 720p–1080p, fallback, aria2c 16 kết nối, 2 fragment và tối đa 2 video tải đồng thời toàn app.

## Chạy kiểm tra trên Windows

```powershell
npm.cmd install
npm.cmd run doctor:windows
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```

Chưa chạy build/installer trong giai đoạn test.

## Ca kiểm thử 1 — Timeline TXT

1. Chạy một quy trình Tải & Ghép đến khi hoàn tất.
2. Mở **Chi tiết đầu ra, dung lượng và timeline**.
3. Nhấn biểu tượng **Xuất TXT** ở góc khối đầu ra.
4. Xác nhận hộp thoại cho chọn tên và nơi lưu.
5. Kiểm tra file chỉ chứa các dòng dạng `00:00 Ph Video_001`.
6. Xác nhận thư mục thành phẩm không tự sinh `.timeline.txt` nếu user chưa bấm xuất.

## Ca kiểm thử 2 — Đầu ra thành phẩm

Chọn:

```text
E:\Ghép video\Thành phẩm\
```

Kết quả đúng:

```text
E:\Ghép video\Thành phẩm\Thanh_pham_1.mp4
```

Không được xuất vào:

```text
E:\Ghép video\Thành phẩm\_normalized\
E:\Ghép video\Thành phẩm\_quarantine\
```

## Ca kiểm thử 3 — Tự dọn file tạm

1. Chạy ghép thành công, chạy lỗi và hủy một quy trình.
2. Kiểm tra thư mục tạm sau khi quy trình đã dừng hẳn.
3. `_normalized`, `_quarantine`, `_yt_tmp`, concat và pending phải được dọn.
4. Khi ghép lỗi, clip hợp lệ được giữ để bấm **Thử lại** nhanh; dữ liệu lỗi và quarantine vẫn bị dọn.
5. File video user tự đặt trong thư mục thành phẩm phải được giữ nguyên.

## Ca kiểm thử 4 — Tải đa nền tảng

Thử tối thiểu một link công khai từ mỗi nhóm đang dùng: YouTube, Google Drive, TikTok, Facebook, Instagram, X/Twitter, Vimeo hoặc nền tảng yt-dlp hỗ trợ.

- Hai link khác nhau nhưng cùng tiêu đề phải tạo hai file có mã `[LINK_XXXXXXXXXXXX]` khác nhau.
- Chạy lại cùng link phải ffprobe file cũ rồi mới skip.
- Tệp lỗi hoặc tải dở phải bị dọn và tải lại.
- Cookies chỉ được gắn khi chính video yêu cầu đăng nhập/xác minh.

## Ca kiểm thử 5 — Preset Tải danh sách khuyên dùng

Trong **Cài đặt → Tải danh sách**, chọn:

```text
Đa nền tảng 720p–1080p · KHUYÊN DÙNG
```

Kiểm tra:

- Chế độ theo nguồn.
- 720p đến 1080p.
- H.264 và MP4.
- Cho phép fallback khi nền tảng không có đúng chuẩn.
- aria2c bật, 16 kết nối.
- 2 fragment đồng thời.
- Tối đa 2 video tải đồng thời toàn ứng dụng.
- Lần aria2c lỗi sẽ retry bằng downloader nội bộ của yt-dlp.

## Ý nghĩa từng preset thành phẩm ghép

- **Nguồn nguyên bản đa nền tảng · ghép nhanh:** giữ nguồn và stream-copy khi tương thích.
- **1080p đồng nhất:** mạnh về khả năng dựng/phát rộng, mọi nguồn về 1080p/30 H.264.
- **Ghép thông minh:** chỉ chuẩn hóa tệp lệch chuẩn.
- **1440p:** cân bằng chi tiết và dung lượng cho màn hình 2K.
- **4K/HEVC:** ưu tiên chi tiết 4K và hiệu quả nén HEVC.
- **Theo nguồn:** ưu tiên HDR/FPS/bitrate gần nguồn.
- **Mã hóa nền:** giữ Windows phản hồi tốt khi đang xử lý.
- **CPU tối đa:** ưu tiên chất lượng libx264 khi chấp nhận thời gian lâu hơn.
