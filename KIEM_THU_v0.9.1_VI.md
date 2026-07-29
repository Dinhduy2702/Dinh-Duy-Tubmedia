# Biên bản kiểm tra Tubmedia v0.9.1

## Phạm vi sửa

- Tải danh sách và Tải & Ghép tiếp tục dùng project, cache và chính sách đầu ra riêng.
- Nguồn cao nhất dùng `bv+ba/b`: video-only tốt nhất cộng audio-only tốt nhất, chỉ dùng bản gộp khi nền tảng không có luồng riêng.
- Luồng nguồn được sắp theo độ phân giải, FPS, dung lượng và bitrate; không áp giới hạn CapCut lên Tải & Ghép.
- Sau tải, ứng dụng ghi lại format ID, độ phân giải, FPS, bitrate, codec, dung lượng dự kiến và dung lượng thực.
- Tệp không phải CapCut nhỏ hơn 80% dung lượng format đã chọn bị chặn và chuyển vào khu cách ly.
- Thành phẩm dùng cấu hình giữ nguồn nhỏ hơn 75% tổng video đã chuẩn bị bị chặn, không ghi đè thành phẩm hợp lệ trước đó.
- Cache v0.9.0 được nâng phiên bản để tệp dung lượng thấp không bị tái sử dụng.
- Thiết lập mặc định của Tải danh sách là cao nhất theo nguồn, không giới hạn độ phân giải, FPS, codec hoặc bitrate.
- Logo nhà phát triển góc trái dưới được tăng kích thước; chữ rút gọn và chia cấp rõ để đọc được trên sidebar.

## Kiểm tra tự động

```powershell
npm.cmd install
npm.cmd run check
```

## Kiểm tra thực tế trên Windows

1. Giải nén gói cập nhật trực tiếp vào source cũ và chọn **Ghi đè tất cả**.
2. Mở **Tải danh sách → Cài đặt**, xác nhận preset **Nguồn cao nhất** đang hoạt động nếu trước đây vẫn dùng mặc định 720p–2160p.
3. Tải lại video từng có bản hơn 500 MB. Nhật ký phải hiện `DOWNLOAD_FORMAT_CONFIRMED`, format ID và dung lượng thực.
4. Mở **Tải & Ghép** với cùng liên kết; xác nhận ứng dụng tải nguồn riêng có hậu tố `[Nguon-chat-luong-cao]`.
5. Xác nhận file cache 200 MB của v0.9.0 không được dùng lại và chỉ bị dọn sau khi file mới hợp lệ.
6. Ghép bằng **Giữ nét và dung lượng gần nguồn**; thành phẩm không được báo thành công nếu nhỏ hơn 75% tổng video đã chuẩn bị.
7. Kiểm tra logo nhà phát triển ở góc trái dưới trong cửa sổ rộng: biểu tượng lớn, các dòng `PHÁT TRIỂN BỞI`, `Đình Duy`, `TUBMEDIA` và `TẢI · XỬ LÝ · GHÉP VIDEO` không chồng nhau.
8. Thu nhỏ cửa sổ dưới 1020 px; sidebar thu gọn chỉ còn logo, không vỡ bố cục.

