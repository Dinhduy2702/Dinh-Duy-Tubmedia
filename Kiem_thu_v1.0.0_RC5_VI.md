# KIỂM THỬ TUBMEDIA v1.0.0 RC5

## Mục tiêu

Xác nhận bộ chuẩn bị công cụ không còn chạy `ffmpeg.exe` ngay trong thư mục tải tạm và không làm `npm run dev` dừng khi Windows Application Control chặn tệp.

## Lệnh kiểm tra

```powershell
npm.cmd install
npm.cmd run verify:release
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```

## Kết quả bắt buộc

- Phiên bản `1.0.0-rc.5`.
- Release verification đạt 43 kiểm tra.
- Unit test và integration test đều đạt.
- Nếu Windows cho phép công cụ: `tool\yt-dlp.exe`, `tool\ffmpeg.exe`, `tool\ffprobe.exe` chạy được.
- Nếu Windows vẫn chặn: dev server và giao diện vẫn mở; Trung tâm công cụ hiển thị trạng thái bị chặn, hàng đợi không bị biến thành lỗi hàng loạt.
- Script thử tìm công cụ từ bản Tubmedia cũ và WinGet trước khi tải lại.
- Build release vẫn dừng nếu bộ công cụ bắt buộc chưa chạy được.
