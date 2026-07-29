# Download video Tubmedia v0.6.1 — Cookies theo yêu cầu

## Hành vi mới

- Mở ứng dụng không tự mở trình quản lý cookies và không tự hiện cảnh báo cookies.
- Mọi video luôn được thử tải công khai trước, không gắn cookies vào lệnh yt-dlp.
- Chỉ khi chính video đang tải trả về lỗi cần đăng nhập/cookies, ứng dụng mới xử lý cookies.
- Nếu cookies đã được cấu hình, ứng dụng tự retry một lần bằng cookies mà không bật thông báo làm phiền.
- Nếu chưa có cookies, cookies sai, hết hạn hoặc trình duyệt khóa database, chỉ danh sách/pipeline liên quan bị Pause và người dùng mới nhận thông báo.
- Các danh sách và pipeline khác vẫn tiếp tục chạy.
- Sau khi người dùng thêm cookies và nhấn Tiếp tục, marker cần cookies được giữ để lần tải lại dùng đúng cookies, kể cả sau khi job đã Pause.

## Kiểm thử nhanh

1. Mở ứng dụng và chờ 30 giây: không có popup cookies.
2. Tải một video công khai: log không có `COOKIES_ATTACHED_ON_DEMAND`.
3. Tải một video thật sự yêu cầu đăng nhập:
   - Chưa cấu hình cookies: chỉ lúc đó mới hiện thông báo.
   - Đã cấu hình cookies: ứng dụng tự retry kín đáo; chỉ báo nếu cookies không dùng được.
4. Kiểm tra log kỹ thuật: cookies/token/value luôn bị che.
