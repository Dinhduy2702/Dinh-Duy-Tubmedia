# Migration Plan

1. Bản Next nằm tách biệt; không ghi đè source gốc trong quá trình phát triển.
2. Trước migration: backup SQLite/settings và chạy preview/integrity.
3. Migration `fix_bounded_source_default_v1210` chỉ sửa đúng signature mặc định lỗi 720–1080/H.264/MP4; cấu hình tùy chỉnh khác được giữ nguyên.
4. Project duplicate mới không giữ `source_id` cũ; nguồn sẽ được resolve lại trong scope project mới.
5. Restore backup schema mới hơn ứng dụng bị từ chối.
6. Restore thành công bắt buộc relaunch để loại Zustand/process handle cũ.
7. Backup kèm media chưa được coi là triển khai; API từ chối rõ ràng cho tới khi có manifest/checksum/progress/restore thật.
