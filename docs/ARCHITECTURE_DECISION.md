# ADR-001 — Kiến trúc Tubmedia Next

**Trạng thái:** Chấp nhận cho nhánh hardening 27/07/2026  
**Quyết định:** Giữ Electron + React + TypeScript strict + SQLite, tái cấu trúc theo module và bổ sung lớp an toàn thay vì viết lại toàn bộ.

## Các phương án đã đánh giá

| Phương án | Điểm mạnh | Rủi ro chính | Kết luận |
|---|---|---|---|
| Electron + Node.js + React | Tái sử dụng phần lớn source, yt-dlp/FFmpeg integration và test; UI hiện có; updater/NSIS sẵn | RAM cao hơn native; process control Windows cần integration/native helper | **Chọn** |
| Tauri + Rust + React | Nhẹ, kiểm soát native tốt | Viết lại Main/IPC/process/update/database; rủi ro mất chức năng và tăng thời gian xác minh | Chưa chọn |
| .NET 8 + WinUI 3 | Windows Job Objects và installer tốt; UI native | Chỉ Windows; viết lại gần như toàn bộ; WinUI test/E2E phức tạp | Chưa chọn |
| .NET 8 + Avalonia | Cross-platform, C# mạnh | Viết lại backend/UI; hệ sinh thái updater/installer cần thiết kế lại | Chưa chọn |

## Lý do

Audit chứng minh kiến trúc hiện tại vẫn có các ranh giới Main/Preload/Renderer, SQLite transaction, queue, ProcessManager và Smart Merge có thể sửa an toàn. Các lỗi P0/P1 chủ yếu nằm ở policy và wiring, không phải bằng chứng rằng toàn bộ nền tảng thất bại. Viết lại công nghệ lúc này làm tăng vùng regression và trì hoãn việc chặn mất dữ liệu.

## Ranh giới mới

- Renderer chỉ gửi command và hiển thị event; không truy cập filesystem/process/database.
- Job transition được cưỡng chế tại repository/domain, không tin UI.
- File deletion/cleanup yêu cầu ownership marker hoặc danh sách file được theo dõi rõ ràng.
- Download, normalize, merge và restore phải commit theo transaction/atomic file policy.
- Windows Job Objects vẫn là hạng mục kế tiếp; ProcessManager hiện tại chỉ được coi là chưa xác minh đầy đủ cho tới khi integration test Windows PASS.
