# Database Migrations

SQLite chạy WAL, foreign keys, busy timeout và bảng `schema_migrations`. Mỗi migration có version tăng dần và chạy trong transaction. Backup database trước release có migration lớn. Không sửa nội dung migration đã phát hành.

- v3: lưu lựa chọn chỉ xuất `timeline.txt`.
- v4: thêm `media_sources.download_policy` để phân biệt cache tải thường với nguồn chất lượng cao nhất dành cho Tải & Ghép. Dữ liệu cũ để trống và được tải lại một lần khi dùng cho quy trình ghép.
