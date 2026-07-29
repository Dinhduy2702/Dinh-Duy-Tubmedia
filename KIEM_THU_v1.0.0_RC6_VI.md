# KIỂM THỬ TUBMEDIA v1.0.0 RC6

RC6 dọn sạch toàn bộ 7 lỗi ESLint còn lại của RC5 mà không thay đổi runtime.

## Các lỗi đã sửa

- Khai báo `URL` rõ ràng từ `node:url` trong ba script MJS.
- Loại bỏ callback `async` không có `await`.
- Loại bỏ import `renameSync` không sử dụng.
- Thay `typeof import('electron-updater')` bằng type import `AppUpdater` tương thích quy tắc lint.
- Giữ nguyên cầu CommonJS bằng `createRequire(import.meta.url)`.

## Kết quả bắt buộc trên Windows

```powershell
npm.cmd run verify:release
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```

Mục tiêu: lint 0 lỗi, unit 153/153, integration 15/15.
