# BUILD AND RUN — TUBMEDIA 1.3.0

## Yêu cầu

- Windows 10/11 x64.
- PowerShell 5.1 hoặc PowerShell 7.
- Node.js 20 trở lên; khuyến nghị Node 22 LTS.
- Internet để `npm ci` và chuẩn bị tool.
- Ít nhất 8 GB trống cho hai build và installer.

## Quy trình khuyến nghị

Dùng script `BUILD_VERIFY_1_2_8_THEN_BUILD_INSTALL_1_3_0.ps1` được bàn giao ngoài ZIP.

Script thực hiện hai phase:

1. Sửa continuation gate nếu cần, hoàn tất test/build/cài 1.2.8 và yêu cầu smoke confirmation.
2. Xác minh SHA-256 source 1.3.0, strict-clean check, `npm ci`, full quality gates, NSIS, cài và mở 1.3.0.

## Chạy thủ công trong source 1.3.0

```powershell
npm.cmd ci
npm.cmd run verify:source-completeness
npm.cmd run verify:release
npm.cmd run verify:stable
npm.cmd run verify:editor-workflows
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run dist:nsis-safe
```

## Output

- `release\Download video Tubmedia-Setup-1.3.0-x64.exe`
- `release\Download-video-Tubmedia-1.3.0-SHA256.txt`
- `release\latest.yml`

## Nguyên tắc

- Không dùng `npm audit fix --force`.
- Không push/tag/release GitHub từ script build.
- Không xóa userData khi nâng cấp.
- Không gọi build thành công nếu typecheck/lint/test/E2E hoặc artifact verification thất bại.
