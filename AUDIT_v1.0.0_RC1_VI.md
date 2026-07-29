# Rà soát logic Tubmedia v1.0.0 RC1

## Kết luận kiến trúc

Ứng dụng đã có đủ các khối cốt lõi cho một sản phẩm desktop dài hạn: main/preload/renderer tách biệt, SQLite bền vững, queue phục hồi, công cụ ngoài được quản lý riêng, tải đa nền tảng, pipeline ghép, backup, diagnostics và cập nhật tại chỗ.

## Các lỗi/điểm yếu tìm thấy và đã sửa

1. **Renderer nhận quá nhiều event:** tiến trình, log và queue trước đây cập nhật store ngay từng dòng. Đã gom theo batch 150/220/280 ms và CSS nội suy thanh tiến trình.
2. **StrictMode làm dev trông giật hơn:** đã bỏ double effect/render trong renderer dev.
3. **Topbar render lại theo toàn bộ mảng:** chuyển sang selector tóm tắt và shallow compare.
4. **Route nạp đồng loạt:** chuyển các trang sang lazy import.
5. **Polling dung lượng quá dày:** từ 2,5 giây cố định thành 4 giây khi chạy, 12 giây khi rảnh, 20 giây khi ẩn; chỉ set state khi số liệu đổi.
6. **Khử trùng log O(n²):** thay bằng Map O(n).
7. **Thông báo biến mất đột ngột:** thêm entering/visible/leaving, hai requestAnimationFrame, pause khi hover/focus và timer theo mức độ.
8. **Lỗi quan trọng tự biến mất:** error hiện giữ lại cho tới khi người dùng đóng.
9. **Queue tick có thể chồng nhau:** thay setInterval bằng scheduler không overlap; 350 ms khi chạy, 1 giây khi rảnh và wake ngay khi queue đổi.
10. **Thông báo DISK_FULL bị gọi hai lần:** đã xóa lời gọi trùng.
11. **Windows có thể ngủ giữa lúc xử lý:** dùng powerSaveBlocker chỉ khi có job active và tự trả lại khi rảnh.
12. **Auto update chưa có UI/route:** thêm Trung tâm cập nhật, badge topbar, sidebar và event typed.
13. **Update có thể xung đột shutdown handler:** thêm prepareForInstall để dừng queue/process, đóng database sạch rồi mới giao quyền thoát cho NSIS updater.
14. **Update khi còn job chạy:** nút cài bị chặn; tải update vẫn chạy nền.
15. **Update thiếu backup giới hạn:** backup trước update được tách riêng và chỉ giữ 5 bản gần nhất.
16. **Backup ghi sai version 0.5.0 trong packaged app:** dùng app.getVersion() và đọc sidecar khi preview.
17. **Log file xoay vòng có thể tăng mãi:** dọn file log theo logRetentionDays, không chỉ dọn record SQLite.
18. **Installer cũ và updater installer có thể lệch thư mục:** thêm cầu nối NSIS đọc InstallLocation cũ và migrate sang installer chuẩn.
19. **Release cũ không tạo metadata updater chuẩn:** production release dùng electron-builder NSIS, YML và blockmap; custom NSIS giữ dưới lệnh legacy.
20. **Bảo mật renderer:** sandbox + contextIsolation + nodeIntegration=false; chặn webview và từ chối permission web mặc định.
21. **Theme/animation nặng:** bỏ backdrop-filter khỏi card lớn, tắt animation trang/card không cần thiết khi media chạy và giữ motion ngắn dùng transform/opacity.
22. **Thông báo vẫn có thể khựng trên GPU tích hợp:** bỏ hoàn toàn blur/backdrop-filter động khỏi toast, chỉ animate opacity + translate3d/scale và giảm hiệu ứng trang trí khi FFmpeg đang chạy.
23. **Ghi file log chặn main thread:** thay appendFileSync theo từng dòng bằng hàng đợi ghi file bất đồng bộ 140 ms; SQLite vẫn ghi ngay, log được flush trước khi đóng hoặc cài cập nhật.

## Chức năng hiện có

- Tải danh sách đa nền tảng, 1–4 lane, worker tùy máy.
- Skip theo link và ffprobe; video trùng title vẫn tải đủ.
- aria2c thử trước cho nền tảng phù hợp, yt-dlp fallback.
- Cookies theo nhu cầu và tạm dừng đúng lane.
- Tải & ghép Google Drive/đa nền tảng, cache riêng từng project.
- Stream-copy khi tương thích; chuẩn hóa có kiểm soát khi bắt buộc.
- Pause/resume/cancel/retry theo job, lane và toàn bộ.
- Tự dọn tệp tạm/quarantine/normalized/part/concat/pending.
- Timeline hiển thị và Save As TXT.
- Backup/restore, diagnostics, tool health/update/repair.
- Auto update app có kênh beta/stable và nâng cấp tại chỗ.
- Dark black-red và Light white-red.

## Những việc bắt buộc xác nhận trên Windows trước bản stable

- Typecheck, lint, unit, integration và production build.
- Test tải hai lane song song trên ít nhất ba nền tảng.
- Test ghép Google Drive 4 video và kiểm tra dung lượng thành phẩm.
- Test đóng/mở, pause/resume và mất mạng.
- Test beta update từ một installer version thấp lên version cao hơn.
- Ký số installer trước phát hành công khai.

Không nên đổi version thành stable hoặc đưa lên server update trước khi các bước trên đều đạt.
