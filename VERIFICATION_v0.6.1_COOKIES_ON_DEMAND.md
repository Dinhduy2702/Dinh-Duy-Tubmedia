# Verification — Download video Tubmedia v0.6.1

## Thay đổi trọng tâm

- Tách chính sách cookies khỏi lần tải công khai đầu tiên.
- Thêm marker theo job để chỉ gắn cookies sau khi chính video báo cần xác thực.
- Tự retry kín đáo bằng cookies đã cấu hình trước khi yêu cầu người dùng thao tác.
- Giữ marker `AUTHENTICATION_REQUIRED` / `BROWSER_COOKIE_DATABASE_LOCKED` khi Resume.
- Không phân loại nhầm lỗi quyền truy cập thành lỗi cookie database khi cookies chưa được dùng.

## Kiểm tra đã thực hiện trong môi trường tạo patch

- Biên dịch TypeScript riêng cho `domain.ts`, `cookie-policy.ts`, `app-errors.ts`: PASS.
- 8/8 assertion chính sách cookies on-demand: PASS.
- Quét parser TypeScript trên các file thay đổi: không phát hiện lỗi cú pháp TS1xxx.
- Kiểm tra cấu trúc ZIP và checksum: thực hiện sau khi đóng gói.

## Chưa xác nhận trong môi trường tạo patch

Toàn bộ `npm.cmd run check` chưa chạy được vì thư mục source trong môi trường tạo patch không có `node_modules` Electron/React/Vitest. Máy Windows đích phải chạy:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
```

## Kịch bản nghiệm thu Windows

1. Mở app và không thao tác trong 30 giây: không có thông báo cookies.
2. Tải video công khai: không có `COOKIES_ATTACHED_ON_DEMAND` trong log job.
3. Cấu hình Firefox hoặc cookies.txt, rồi tải video công khai: vẫn không đọc cookies.
4. Tải video cần đăng nhập: app tự retry bằng cookies đã cấu hình.
5. Xóa cấu hình cookies và tải video cần đăng nhập: lúc đó mới hiện thông báo thêm cookies.
6. Chọn Chrome đang mở và retry video cần đăng nhập: chỉ list liên quan báo database bị khóa.
7. List/pipeline khác vẫn chạy bình thường.
