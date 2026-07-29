# TUBMEDIA NEXT — BÁO CÁO TRIỂN KHAI HARDENING

**Ngày:** 27/07/2026  
**Cơ sở:** source Tubmedia 1.2.0, báo cáo audit ngày 27/07/2026 và gói evidence.  
**Nguyên tắc:** tạo project tách biệt, không sửa/xóa bản source gốc, không tuyên bố PASS cho phần chưa chạy được.

# A. KIẾN TRÚC ĐÃ CHỌN

## Công nghệ

- Electron + React + TypeScript strict.
- SQLite làm nguồn trạng thái bền vững.
- yt-dlp, aria2c, FFmpeg và ffprobe dưới ProcessManager/QueueManager.
- Electron Builder + NSIS cho Windows.

## Quyết định

Giữ kiến trúc hiện tại thay vì chuyển sang Tauri/.NET trong đợt hardening này. Audit cho thấy các lớp bảo mật Electron, database, queue và Smart Merge có nền tảng sửa tiếp được; viết lại toàn bộ sẽ tăng rủi ro mất chức năng và kéo dài thời gian chưa có bằng chứng kỹ thuật cần thiết.

Chi tiết đánh giá Electron/Tauri/.NET và lý do chọn được ghi tại `docs/ARCHITECTURE_DECISION.md`.

## Ranh giới mới được bổ sung hoặc siết chặt

- `FileOwnershipService`: sentinel cho namespace Tubmedia.
- `AtomicFileCommit`: commit không ghi đè tệp đang tồn tại.
- `JobStateMachine`: bảng chuyển trạng thái trung tâm.
- `SafeJson`: dữ liệu persistence hỏng không làm bootstrap throw trực tiếp.
- `SecretRedaction` + `DiagnosticExporter`: lọc dữ liệu nhạy cảm trước khi đóng gói.
- Mở rộng media model cho rotation, SAR/DAR, VFR và HDR type.

## Khả năng migration

- Không thay database schema phá vỡ tương thích trong đợt này.
- Có migration settings để sửa default `source` bị giới hạn 1080p/H.264 nhưng không tự đổi preset tùy chỉnh không khớp signature lỗi.
- Duplicate project không còn giữ `source_id` project cũ.
- Restore từ schema mới hơn bị từ chối; restore hợp lệ kiểm tra SQLite integrity/FK và relaunch.

# B. CHỨC NĂNG ĐÃ HOÀN THÀNH Ở MỨC SOURCE

| Chức năng | Trạng thái | File chính | Test/gate | Bằng chứng hiện tại |
|---|---|---|---|---|
| Chất lượng nguồn không giới hạn 1080p | Đã sửa source | `defaults.ts`, `settings-service.ts`, `download-quality.ts` | Hardening + behavior probe | Selector nguồn cao nhất không cap resolution |
| Không ghi đè remux/CapCut | Đã sửa source | `non-conflicting-path.ts`, `download-engine.ts` | Unit test + behavior probe | Tệp cũ được giữ; output mới nhận suffix |
| Không ghi đè final/timeline | Đã sửa source | `merge-engine.ts`, `timeline-service.ts` | Hardening + unit test source | Commit dùng hard-link/COPYFILE_EXCL |
| Cleanup theo ownership | Đã sửa source | `file-ownership.ts`, `temporary-cleanup.ts` | Hardening + unit tests | Quarantine bị loại khỏi cleanup namespace |
| Mute-only stream copy | Đã sửa source | `clip-engine.ts` | Unit test source | `-c:v copy -an`, không `libx264` |
| No-upscale/no-crop mặc định | Đã sửa source | `normalize-engine.ts` | Stable + hardening | `decrease + pad`, không `increase/crop` |
| State transition backend | Đã sửa source | `job-state-machine.ts`, queue repository/manager | Hardening + table test source | Illegal resume/retry bị reject |
| Unsupported job type | Đã sửa source | `queue-manager.ts` | Hardening | Analyze/normalize/verify không thể complete giả |
| Restore an toàn hơn | Đã sửa source | `backup-service.ts`, IPC | Hardening | Active runtime bị chặn, integrity/FK check |
| Backup kèm media giả | Đã loại hành vi giả | `backup-service.ts` | Hardening | `includeMedia=true` trả lỗi rõ ràng |
| Tool checksum | Đã sửa source | `tool-update-service.ts` | Hardening | Không SHA-256 thì từ chối cài |
| HDR/rotation/SAR/DAR/VFR | Đã mở rộng | media analyzer/domain/compatibility | Unit test source + behavior HDR | 10-bit SDR không tự coi HDR; all-HDR Auto giữ HDR |
| Diagnostic secret redaction | Đã sửa source | logger/exporter/IPC | Hardening + unit test source | Log được sanitize trước khi copy |
| Installer source self-contained | Đã bổ sung | `installer/*`, `LICENSE.txt` | Release/stable gates | Không còn tham chiếu installer file thiếu |
| Timeline option backend | Đã sửa source | queue/merge/timeline | Hardening | Flag thật được truyền; failure thành warning |
| Size guard trước normalize | Đã sửa source | `merge-engine.ts` | Hardening | So output với input MediaInfo trước normalize |

# C. LỖI AUDIT ĐÃ XỬ LÝ

Bảng đầy đủ theo từng ID được ghi tại `docs/AUDIT_FIX_STATUS.md`.

## P0

- TM-P0-01 và TM-P0-02: bỏ destructive overwrite cho remux/CapCut.
- TM-P0-03: restore chỉ khi idle, có schema/integrity/FK validation và relaunch.
- TM-P0-04: cleanup chỉ đụng namespace có ownership sentinel; quarantine được bảo toàn.

## P1

Đã có bản vá source cho default chất lượng, migration, no-upscale/crop, executor giả, state transition, mute-only, HDR metadata, size guard, checksum updater, installer files và duplicate source identity. Process pause/resume/cancel được cải thiện nhưng chưa thể chứng minh hoàn chỉnh trên Windows vì chưa có Job Objects/integration environment.

## P2/P3

Đã sửa timeline wiring, safe JSON, diagnostic redaction, timeline critical path và tài liệu/version. Cache retention scheduler, backup media thật, start-workflow mutex và UI redesign vẫn chưa hoàn tất.

# D. KẾT QUẢ KIỂM THỬ

| Lệnh | Trạng thái | Thời gian | Kết quả |
|---|---|---:|---|
| `npm run check:assets` | PASS | 0,18 giây | 2 PNG, 1 ICO, 1 SVG hợp lệ |
| `npm run verify:release` | PASS | 0,10 giây | 49 checks |
| `npm run verify:stable` | PASS | 0,13 giây | 49 release + 24 stable checks |
| `npm run verify:audit-hardening` | PASS | 0,10 giây | 27 audit-focused static checks |
| `npm run verify:audit-behavior` | PASS | 0,16 giây | 4 direct behavior probes |
| Syntax-only TypeScript probe | PASS giới hạn | — | Không có lỗi parser TS1xxx |
| `npm ci --ignore-scripts --offline` | BLOCKED BY ENVIRONMENT | 0,67 giây | `ENOTCACHED` cho `zustand-5.0.14` |
| `npm run typecheck` | BLOCKED BY ENVIRONMENT | 0,53 giây | Thiếu `electron`/`node` types |
| `npm run lint` | BLOCKED BY ENVIRONMENT | 0,07 giây | `eslint` chưa cài |
| `npm run test` | BLOCKED BY ENVIRONMENT | 0,08 giây | `vitest` chưa cài |
| `npm run test:integration` | BLOCKED BY ENVIRONMENT | 0,07 giây | `vitest` chưa cài |
| `npm run build` | BLOCKED BY ENVIRONMENT | 0,55 giây | Dừng ở typecheck |

Log đầy đủ nằm trong `verification/logs/`.

## Test mới đã thêm nhưng chưa chạy bằng Vitest

- State-machine transition table.
- Non-conflicting/atomic file commit.
- Mute-only stream copy.
- Timeline không ghi đè.
- HDR 10-bit SDR.
- Safe JSON persistence.
- Secret redaction.
- Process error taxonomy.
- No-upscale/crop và ownership cleanup regressions.

# E. KẾT QUẢ CHẤT LƯỢNG MEDIA

## Đã chứng minh bằng source/behavior probe

- Download-only source selector không giới hạn 1080p.
- Merge source selector độc lập với download-only settings.
- Mute-only không chủ động encode video.
- Normalize mặc định không crop/upscale.
- HDR Auto giữ HDR khi mọi nguồn là HDR.
- Concat/final commit không ghi đè output cũ.
- Size guard dùng input trước normalize.

## Chưa xác minh bằng FFmpeg/ffprobe thật

- Packet hash chứng minh stream copy.
- Video nguồn 500 MB và output size ratio.
- HDR10/HLG/Dolby Vision metadata đầu ra.
- VFR, rotation, SAR, timestamp repair và audio drift.
- 4K/1080p, 60/30 FPS và mixed codecs.

Do đó không có tuyên bố rằng media pipeline đã PASS hoàn chỉnh.

# F. KẾT QUẢ GIAO DIỆN

- Không thực hiện redesign toàn bộ UI trong đợt hardening này.
- Backend controls/state truth được siết ở queue/state machine.
- Chưa chạy visual screenshot matrix tại 1280×720 đến 2560×1440 và scaling 100/125/150%.
- Chưa chứng minh log virtualization, flicker và responsive trên Windows GUI.

Trạng thái: **NOT VERIFIED / CHƯA HOÀN THIỆN THEO MASTER PROMPT**.

# G. KẾT QUẢ INSTALLER

## Đã hoàn thành

- Khôi phục `installer/identity.json`.
- Bổ sung NSIS include và script nguồn.
- Release/static gates không còn lỗi file thiếu.

## Chưa hoàn thành

- Chưa build installer Windows trong sandbox Linux.
- Chưa code-sign.
- Chưa test clean install, upgrade, uninstall, reinstall.
- Chưa kiểm tra app identity/publisher trên VM thật.

Không có installer `.exe` được tuyên bố là bản phát hành.

# H. PHÁN QUYẾT PHÁT HÀNH

## CHƯA ĐỦ ĐIỀU KIỆN PHÁT HÀNH

Project hardening đã xử lý phần lớn lỗi source P0/P1 có bằng chứng trong audit và đã vượt qua các gate tĩnh/hành vi có thể chạy. Tuy nhiên các điều kiện bắt buộc sau chưa đạt:

1. Dependency install, typecheck, lint, unit/integration/E2E và build chưa chạy được.
2. Windows process tree pause/resume/cancel chưa được kiểm chứng.
3. Media regression bằng FFmpeg/ffprobe và packet hash chưa chạy.
4. UI visual/scaling matrix chưa chạy.
5. Installer Windows chưa build và chưa test lifecycle.
6. Backup kèm media, native Job Objects, cache retention đầy đủ và UI redesign chưa hoàn thiện.

Bản bàn giao này là **source hardening có thể tiếp tục kiểm thử và hoàn thiện**, không phải bản thương mại hoàn chỉnh hay installer phát hành.
