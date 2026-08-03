# FIX SUMMARY — TUBMEDIA 1.3.0

## Tổng quan

Tubmedia 1.3.0 là đợt nâng cấp lớn tiếp nối backend 1.2.8. Mục tiêu của đợt này là tạo thay đổi nhìn thấy ngay đối với editor, đồng thời giữ các nguyên tắc an toàn đã có: không ghi đè, không upscale ngoài policy, xác minh media trước khi hoàn tất, Electron isolation và quản lý process tập trung.

## Kiến trúc trước

- Điều hướng thiên về trang kỹ thuật, chưa có điểm bắt đầu theo workflow editor.
- Queue thiếu tìm kiếm, lọc dự án, chọn nhiều và virtualization.
- Import tập trung vào văn bản, chưa có trải nghiệm TXT/CSV/kéo thả/loại trùng rõ ràng.
- Quick Download chủ yếu video+audio, chưa có sidecar và media-mode đầy đủ.
- Lịch sử và chẩn đoán chưa có trang tập trung riêng.

## Kiến trúc sau

- `EditorHomePage` là trang mặc định, tổng hợp dữ liệu thật từ store.
- Sidebar được chia thành Editor Studio, Hệ thống và Công cụ nâng cao.
- Queue Studio dùng virtualization, detail drawer và bulk IPC thật.
- History dùng dữ liệu queue bền vững và native save dialog để xuất CSV/JSON.
- Diagnostics dùng ToolManager, SystemStats và Logger.
- Import Links hỗ trợ TXT/CSV/kéo thả/preview/duplicate identity.
- Quick Download contract, command builder, service và verifier hỗ trợ video+audio, audio-only, video-only, SRT, thumbnail, metadata.
- Built-in quality profiles bổ sung CFR/NLE/proxy.

## Module viết lại hoặc thay đổi lớn

- `src/renderer/src/layout/Sidebar.tsx`
- `src/renderer/src/pages/QueuePage.tsx`
- `src/renderer/src/features/projects/ImportLinksDialog.tsx`
- `src/renderer/src/components/QuickDownloadPanel.tsx`
- `src/main/download/quick-download-command.ts`
- `src/shared/quick-download.ts`

## Module mới

- `EditorHomePage.tsx`
- `HistoryPage.tsx`
- `DiagnosticsPage.tsx`
- `WorkflowCard.tsx`
- `VirtualTableWindow.tsx`
- `verify-editor-workflows-1.3.0.mjs`

## Module giữ nguyên và củng cố

- ProcessManager, QueueManager và repository transition.
- Smart Merge/Normalize, output collision protection và quarantine.
- IPC sender validation, Zod schema, context isolation và tool checksum.
- Installer identity để nâng cấp tại chỗ và giữ dữ liệu.

## Rủi ro còn lại

- Full Windows build/test và installer cần chạy bằng script bàn giao trên máy Windows.
- Playlist analyzer chuyên dụng và test 1.000 item chưa được đánh dấu hoàn tất.
- Windows Job Object native, visual regression nhiều DPI và media fixture HDR/VFR toàn diện chưa có bằng chứng chạy đầy đủ.
