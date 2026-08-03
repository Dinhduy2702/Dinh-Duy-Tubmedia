# TUBMEDIA 1.3.0 — TÓM TẮT NÂNG CẤP LỚN

## Mục tiêu

Tubmedia 1.3.0 chuyển ứng dụng từ giao diện quản trị kỹ thuật sang **Editor Studio**: thao tác chính được tổ chức quanh tải nguồn, tải & ghép, hàng đợi, lịch sử và chẩn đoán. App identity được giữ nguyên để nâng cấp tại chỗ và bảo toàn dữ liệu người dùng.

## Thay đổi nhìn thấy ngay

- Trang Tổng quan Editor mới, hiển thị dữ liệu thật từ hàng đợi, dự án, công cụ và tài nguyên máy.
- Sidebar chia nhóm rõ ràng; System Cleanup được chuyển xuống Công cụ nâng cao.
- Hàng đợi mới có tìm kiếm, lọc trạng thái/dự án, chọn nhiều, bulk pause/resume/cancel/retry/remove, drawer chi tiết và virtualization.
- Lịch sử mới có tìm kiếm, lọc và xuất CSV/JSON.
- Chẩn đoán mới tổng hợp ToolManager, system stats và lỗi gần nhất.
- Dialog nhập nguồn hỗ trợ TXT, CSV, kéo thả, preview, tìm kiếm và loại trùng theo URL + mốc cắt + chế độ âm thanh.
- Quick Download có video+audio, audio-only, video-only, phụ đề SRT, thumbnail và metadata.
- Preset CFR thực cho Adobe Premiere Pro, DaVinci Resolve, CapCut và proxy 720p.

## Thay đổi backend

- Quick Download vẫn dùng ProcessManager, ToolManager và FileVerifier trung tâm.
- Output audio-only/video-only được xác minh đúng stream trước khi báo hoàn tất.
- State cũ thiếu `mediaMode` được migration mềm sang `video-audio`.
- Source completeness phân biệt gói source sạch và workspace có file cache TypeScript.

## Kiểm thử

- Static workflow gate mới: `npm run verify:editor-workflows`.
- Unit test mới: `tests/unit/editor-workflows-1.3.0.test.ts`.
- Full Windows quality pipeline được thực thi bởi script bàn giao trước khi tạo installer.

## Giới hạn được công bố trung thực

Các hạng mục rất lớn như playlist 1.000 item có metadata/thumbnail đầy đủ, Windows Job Object native, waveform editor, visual regression nhiều độ phân giải và media-fixture HDR/VFR toàn diện cần tiếp tục được xác minh trên Windows thực. Không hạng mục nào trong số đó được ghi là hoàn tất nếu chưa có bằng chứng chạy thực tế.

## Đồng bộ Tải nhanh và Timeline tùy chọn

- Tải nhanh không còn bị chặn chỉ vì hàng đợi tải/ghép khác đang hoạt động; chỉ chặn khi Dọn dẹp hệ thống thật sự đang chạy.
- Trạng thái Tải nhanh được khôi phục khi chuyển trang hoặc mở lại panel.
- Lệnh “Tạm dừng tất cả” và “Tiếp tục tất cả” điều khiển cả Quick Download.
- “Tải video theo mốc thời lượng” là một checkbox tùy chọn; Timeline chỉ xuất hiện khi người dùng bật.
- Chỉ còn một nút tải chính, tự chuyển giữa “Tải toàn bộ video” và “Tải đoạn theo Timeline”.
- Thông báo lỗi IPC được rút gọn thành nội dung tiếng Việt dễ hiểu.
