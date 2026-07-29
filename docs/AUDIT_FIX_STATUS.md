# Audit Fix Status

| Audit ID | Trạng thái trong Tubmedia Next | Thay đổi chính | Xác minh còn thiếu |
|---|---|---|---|
| TM-P0-01 / P0-02 | Đã vá source | Remux/CapCut dùng commit không ghi đè và tên đích không xung đột; bỏ `rm(output)` phá dữ liệu | Filesystem/Windows media integration |
| TM-P0-03 | Đã vá source | Restore bị chặn khi queue/process active; kiểm tra schema, integrity, foreign key; relaunch sau restore | Cross-version DB integration trên Windows |
| TM-P0-04 | Đã vá source | Cleanup yêu cầu ownership sentinel; quarantine không còn namespace cleanup; không xóa residue theo suffix ở thư mục dùng chung | Shared-folder và crash-recovery tests |
| TM-P1-01 / P1-02 | Đã vá source | Default `source` không giới hạn resolution/FPS/codec/container; migration sửa default cũ bị bó 1080p/H.264 | yt-dlp selector thực tế đa nền tảng |
| TM-P1-03 / P1-04 | Đã vá source | Normalize dùng `decrease + pad`; không upscale/crop mặc định | Pixel/media regression |
| TM-P1-05 / P1-06 | Đã vá source | Unsupported job type fail rõ; state transition được kiểm tra ở repository và queue controls | Full queue concurrency suite |
| TM-P1-07 | Cải thiện đáng kể | Blocking pause chờ process control; terminal state được đọc lại; phân biệt spawn/timeout/cancel; kiểm tra `taskkill` exit code | Windows process-tree proof/Job Objects |
| TM-P1-08 | Đã vá source | Mute-only dùng `-c:v copy -an`, giữ container nguồn | Packet hash fixture |
| TM-P1-09 / P1-10 / P1-11 | Cải thiện đáng kể | Thêm rotation, SAR/DAR, VFR, HDR type/mastering metadata; 10-bit SDR không tự bị coi HDR; HDR Auto giữ all-HDR | Fixtures HDR10/HLG/Dolby Vision/VFR/rotation |
| TM-P1-12 | Đã vá source | Size guard so với input trước normalize thay vì prepared output | Video nguồn lớn 500 MB regression |
| TM-P1-13 | Đã vá source | Tool update từ chối asset không có SHA-256 | Tampered package test |
| TM-P1-14 | Đã vá source ở mức package | Bổ sung identity và NSIS scripts; release/stable gates PASS | Build installer và VM install tests |
| TM-P1-15 | Đã vá source | Duplicate project không tái sử dụng `source_id` của project cũ | Repository integration |
| TM-P2-01 | Đã vá source | Timeline flag truyền thật tới MergeEngine; timeline dùng commit không ghi đè; lỗi timeline thành warning sau khi video đã commit | Timeline integration |
| TM-P2-02 | Không còn chức năng giả | `includeMedia=true` bị từ chối rõ thay vì ghi metadata giả | Backup media thật chưa triển khai |
| TM-P2-03 | Chưa hoàn tất | Ownership/cleanup đã an toàn hơn | Retention scheduler theo ngày/dung lượng chưa nối toàn bộ runtime |
| TM-P2-04 | Đã vá repositories chính | JSON lỗi dùng decoder fallback an toàn | Corrupted-database integration |
| TM-P2-05 | Chưa hoàn tất đầy đủ | Transition/idempotency nền tảng được siết | Start-workflow mutex/request-id vẫn cần integration |
| TM-P2-06 | Cải thiện | Process error taxonomy và terminal reason rõ hơn | PID reuse/orphan/timeout Windows tests |
| TM-P2-07 | Đã vá source | Diagnostic exporter lọc cookies, Authorization, token và URL secrets trước khi ghi bundle | Secret corpus integration |
| TM-P2-08 | Đã vá source | Timeline failure không làm final video đã commit chuyển failed | Permission-denied timeline test |
| TM-P2-09 / P3 | Đã chỉnh tài liệu chính | README/version/Smart Merge mô tả gần với code mới | Visual/product copy review |
