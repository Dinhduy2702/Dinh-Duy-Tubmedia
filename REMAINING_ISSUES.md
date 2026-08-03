# REMAINING ISSUES — TUBMEDIA 1.3.0

## P1

Không có P1 mới được phát hiện bởi các static gate hiện tại. Tuy nhiên, kết luận “không còn P1 trên Windows” là **CHƯA XÁC MINH** cho đến khi full pipeline và smoke test thật PASS.

## P2 còn lại

### PLS-01 — Playlist analyzer/chọn item chuyên dụng

- Ảnh hưởng: chưa có bảng metadata/thumbnail để chọn subset của playlist 100–1.000 item.
- Hiện trạng: executor vẫn dùng `--no-playlist` để tránh tải ngoài ý muốn; người dùng có thể nhập nhiều URL/TXT/CSV.
- Bước tiếp: service yt-dlp flat-playlist, persistence item, table virtualization và tests private/deleted/duplicate.

### PROC-01 — Windows Job Object native và PID reuse

- Ảnh hưởng: ProcessManager hiện có process-tree control, nhưng test native Job Object/PID reuse toàn diện chưa có bằng chứng.
- Bước tiếp: helper native hoặc PowerShell/C# bridge có identity token và Windows integration tests.

### MED-01 — Media regression matrix lớn

- Ảnh hưởng: HDR/VFR/rotation/SAR/5.1/non-monotonic DTS chưa được chạy đủ fixture matrix trong bản 1.3.0.
- Bước tiếp: tạo fixture bằng FFmpeg và assert stream-copy/remux/audio-only transcode/output audit.

### UI-01 — Visual regression nhiều DPI

- Ảnh hưởng: responsive CSS đã có nhưng chưa chụp matrix 1280×720 đến 2560×1440 ở 100/125/150%.
- Bước tiếp: Playwright screenshot matrix trên Windows.

### INS-01 — Uninstall/reinstall policy test

- Ảnh hưởng: installer giữ app data theo cấu hình, nhưng chu kỳ uninstall/reinstall chưa tự động hóa hoàn toàn.
- Bước tiếp: clean VM test và xác nhận lựa chọn dữ liệu.
