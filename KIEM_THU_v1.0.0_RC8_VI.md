# KIỂM THỬ TUBMEDIA v1.0.0 RC8

RC8 sửa lỗi NSIS không chấp nhận phiên bản SemVer có hậu tố như `1.0.0-rc.7`, đồng thời buộc bản build an toàn chuẩn bị đủ công cụ bắt buộc trước khi đóng gói.

## Kết quả bắt buộc

Chạy:

```powershell
npm.cmd run verify:release
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dist:nsis-safe
```

Trong log build phải có:

```text
WinVer: 1.0.0.8 (display 1.0.0-rc.8)
BUILD INSTALLER SUCCESS
```

Tên installer vẫn phải là:

```text
Download video Tubmedia-Setup-1.0.0-rc.8-x64.exe
```
