TUBMEDIA NEXT FIXED 2026-07-28

1. Giải nén toàn bộ ZIP vào một thư mục mới, không chép đè thư mục đã sửa trước đó.
2. Nhấp đúp RUN_VERIFY_AND_BUILD_FIXED.cmd.
3. Script tự kiểm tra Node.js 24, cài dependency, chuẩn bị tool, chạy toàn bộ gate và tạo installer.
4. Log nằm ngoài source tại:
   %LOCALAPPDATA%\Tubmedia\VerificationLogs
5. Installer thành công nằm tại:
   release\Download video Tubmedia-Setup-1.2.0-x64.exe

Không chạy prettier --write . trước khi kiểm thử.
Không chép verification-logs hoặc file backup .ts/.tsx vào source.
