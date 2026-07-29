# Biên bản kiểm tra Tubmedia v0.8.9

## Phạm vi bản sửa

- Sửa lỗi `workbench:pause` trên Windows khi PID đang tự kết thúc.
- Nhận diện và bỏ qua an toàn:
  - Windows `87`: tham số/PID không còn hợp lệ.
  - Windows `1168`: không còn tìm thấy tiến trình.
  - NTSTATUS `-1073741813`: `STATUS_INVALID_CID`.
  - NTSTATUS `-1073741558`: `STATUS_PROCESS_IS_TERMINATING`.
- Tạm dừng cây tiến trình theo thứ tự con trước, cha sau.
- Tiếp tục cây tiến trình theo thứ tự cha trước, con sau.
- Nếu tiến trình cha biến mất giữa thao tác tạm dừng, tự tiếp tục lại những tiến trình con vừa bị tạm dừng để không tạo tiến trình treo mồ côi.
- Lệnh tạm dừng/tiếp tục được tuần tự hóa và có tính lặp an toàn.
- Giữ nguyên toàn bộ thay đổi của v0.8.8.

## Kiểm thử tự động

- Asset: 2 PNG, 1 ICO và 1 SVG hợp lệ.
- TypeScript: đạt.
- ESLint: đạt, không có cảnh báo.
- Unit test: 106/106 đạt.
- SQLite integration: 11/11 đạt.
- Production build Electron main/preload/renderer: đạt.

## Cách chạy

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.9_SOURCE_FULL_FIX"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Đây là source kiểm thử, chưa tạo installer Windows.
