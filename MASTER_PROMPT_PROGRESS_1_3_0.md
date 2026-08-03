# MASTER PROMPT PROGRESS — TUBMEDIA 1.3.0

Trạng thái dưới đây chỉ dùng **ĐÃ TRIỂN KHAI**, **ĐÃ CÓ SẴN**, **MỘT PHẦN** hoặc **CHƯA XÁC MINH**.

| Nhóm | Trạng thái | Bằng chứng chính |
|---|---|---|
| Build/source completeness/installer identity | ĐÃ TRIỂN KHAI | `verify-source-completeness`, installer source, combined Windows pipeline |
| Quick Download backend thật | ĐÃ TRIỂN KHAI | ProcessManager + ToolManager + FileVerifier + persistence |
| Thời lượng >23 giờ và giữ sau restart | ĐÃ TRIỂN KHAI | duration verifier và unit test |
| Audio-only / video-only / subtitle / thumbnail / metadata | ĐÃ TRIỂN KHAI | request contract, yt-dlp command builder, stream verification |
| Nhiều URL, TXT, CSV, kéo thả, loại trùng | ĐÃ TRIỂN KHAI | ImportLinksDialog + parser/import IPC hiện có |
| Queue search/filter/multi-select/virtualization | ĐÃ TRIỂN KHAI | QueuePage + VirtualTableWindow + IPC thật |
| History CSV/JSON | ĐÃ TRIỂN KHAI | HistoryPage + saveTextFile IPC |
| UI/UX Editor Studio và Việt hóa phần mới | ĐÃ TRIỂN KHAI | EditorHome, Sidebar, Diagnostics, CSS 1.3 |
| Preset Premiere/Resolve/CapCut/CFR/proxy | ĐÃ TRIỂN KHAI | built-in quality profiles |
| Smart Merge chọn lọc, chống upscale/overwrite | ĐÃ CÓ SẴN | existing audit-hardening gates |
| Output verification/quarantine | ĐÃ CÓ SẴN và mở rộng | FileVerifier + existing quarantine pipeline |
| Playlist analyze, chọn item, thumbnail cho 1.000 item | MỘT PHẦN | Executor vẫn an toàn `--no-playlist`; UI phân tích playlist chuyên dụng chưa hoàn tất |
| State machine duy nhất có revision cho mọi job | MỘT PHẦN | repository transition checks có sẵn; chưa migration toàn bộ sang revision thống nhất |
| Windows Job Object native/PID reuse hardening | CHƯA XÁC MINH | cần test process tree trên Windows thực |
| Media fixtures HDR/VFR/rotation/SAR/5.1 | CHƯA XÁC MINH | cần FFmpeg fixture suite và thời gian chạy thực |
| Visual regression 1280×720 đến 2560×1440, 100–150% | CHƯA XÁC MINH | responsive CSS có; chưa có screenshot matrix đầy đủ |
| Clean install/upgrade/uninstall/reinstall | CHƯA XÁC MINH trong container | combined Windows script thực hiện build/install; uninstall test vẫn cần thao tác máy thật |

## Phán quyết

Source 1.3.0 là một đợt nâng cấp lớn có thay đổi nhìn thấy và backend thật. Chỉ sau khi combined Windows pipeline PASS và smoke test thực tế được xác nhận mới được coi installer là ứng viên phát hành. Không tự push, tạo tag hoặc GitHub Release.
