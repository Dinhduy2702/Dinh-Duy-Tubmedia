# Tubmedia Next — Validation Fix Report

Ngày: 2026-07-28  
Phiên bản source: 1.2.0 validation-fix

## Mục tiêu

Sửa trực tiếp source sạch từ `Tubmedia_Next_Hardening_2026-07-27.zip`, không tiếp tục vá lên thư mục Windows đã bị `prettier --write .` và các script backup làm thay đổi.

## Nguyên nhân gốc

1. Một số unit test kiểm tra nguyên văn JSX/CSS và phụ thuộc khoảng trắng, nên Prettier làm test FAIL dù UI vẫn giữ nguyên chức năng.
2. Các script cũ lưu bản sao `.ts/.tsx` dưới `verification-logs`, khiến `eslint .` quét nhầm file backup ngoài TypeScript project.
3. `timeline-service-safety.test.ts` dùng fixture `MediaInfo` thiếu trường bắt buộc và kỳ vọng định dạng timeline không khớp định dạng sản phẩm.
4. NSIS installer chưa dò đủ khóa uninstall cũ, chưa đánh dấu upgrade rõ ràng và thiếu `FileVersion` dạng hiển thị.
5. Test Smart Merge vẫn đóng đinh hành vi upscale/crop cũ, trái với hardening `allowUpscale=false` và content-preserving padding.
6. Chuỗi FFmpeg dùng `\,` trong TypeScript chỉ tạo dấu phẩy thường ở runtime; cần `\\,` trong source để FFmpeg nhận `\,`.

## Thay đổi chính

- Thêm ignore vĩnh viễn cho `verification-logs`, `test-results`, `playwright-report` trong ESLint/Prettier/Git.
- Thêm gate `verify:gate-fixes` gồm 19 kiểm tra không phụ thuộc dependency ngoài.
- Sửa escape biểu thức `min(iw\,...)` và `min(ih\,...)` truyền cho FFmpeg.
- Viết lại logic dò upgrade NSIS theo registry hiện tại, uninstall key hiện tại và legacy key.
- Giữ thư mục cài đặt cũ khi nâng cấp, bỏ qua trang chọn thư mục và bật `SetOverwrite on` sau khi đóng process cũ.
- Thêm `FileVersion`/`ProductVersion` đúng vào version resource.
- Chuyển unit test UI từ so sánh khoảng trắng tuyệt đối sang regex/compact markup.
- Cập nhật Smart Merge test theo chính sách không implicit upscale/crop.
- Sửa fixture Timeline `MediaInfo` đầy đủ và kỳ vọng đúng `00:02 Ph Video_002`.
- Sửa các mock async không có `await` để đạt typed ESLint.
- Thêm `VERIFY_AND_BUILD_FIXED_WINDOWS.ps1`; log nằm ngoài project tại `%LOCALAPPDATA%\Tubmedia\VerificationLogs` và script không chỉnh sửa source.

## Kết quả đã chạy trong môi trường hiện tại

| Gate | Kết quả |
|---|---|
| TypeScript parser cho 170 file TS/TSX | PASS, 0 syntax error |
| Validation fix checks | PASS, 19/19 |
| Release verification | PASS, 49 checks |
| Stable verification | PASS, 24 checks |
| Audit hardening verification | PASS, 27 checks |
| Audit behavior verification | PASS, 4 checks |
| Static checks bổ sung | PASS, 24/24 |

## Chưa tuyên bố PASS

- `npm ci` trong container bị registry nội bộ trả HTTP 503 khi tải `zustand-5.0.14.tgz`.
- Vì không cài được dependency, chưa chạy Vitest/ESLint/TypeScript semantic build/Electron E2E trong container này.
- Installer Windows chưa được tạo trong Linux và cần chạy script bàn giao trên Windows Node.js 24 LTS.

## Lệnh xác minh trên Windows

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
Unblock-File .\VERIFY_AND_BUILD_FIXED_WINDOWS.ps1
.\VERIFY_AND_BUILD_FIXED_WINDOWS.ps1 -BuildInstaller
```

Script sẽ dừng tại gate lỗi thật đầu tiên và lưu log ngoài source project.
