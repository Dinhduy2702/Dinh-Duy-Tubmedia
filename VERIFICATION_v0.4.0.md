# Verification Report — v0.4.0

## Đã kiểm tra trong môi trường tạo gói

- Package version: 0.4.0.
- 1–4 download lane IDs và 1–4 merge lane IDs tồn tại trong domain + workbench backend.
- Native Electron application menu bị gỡ và menu bar bị ẩn.
- CSP meta không còn directive `frame-ancestors` không hợp lệ.
- Ba phương thức cookies có IPC/backend/frontend tương ứng: browser, paste, file.
- Browser cookie database lock được chuyển thành AppError chuyên biệt và hướng dẫn thân thiện.
- Clear progress và clear logs có contract, IPC, backend và UI riêng theo slot.
- Targeted strict TypeScript check cho renderer mới: PASS.
- Targeted strict TypeScript check cho backend/core mới: PASS.
- TypeScript transpile syntax scan toàn bộ TS/TSX: PASS.
- Hidden Unicode whitespace scan: PASS, 0 ký tự bất thường.

## Chưa thể xác nhận trong container

Không tuyên bố full `npm run check` hoặc Windows installer đã PASS trong container vì quá trình tải đầy đủ npm dependencies bị timeout. Người dùng cần chạy `npm.cmd run check` trên máy Windows đã có node_modules thực tế.

## Chuỗi kiểm tra bắt buộc trên Windows

```powershell
Remove-Item ".\out" -Recurse -Force -ErrorAction SilentlyContinue
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run dev
```

Sau khi thử nghiệm workflow thật thành công:

```powershell
npm.cmd run dist
```
