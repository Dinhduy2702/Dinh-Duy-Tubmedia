# Data Model

SQLite tiếp tục là nguồn trạng thái bền vững duy nhất. Zustand chỉ là cache hiển thị.

## Nguyên tắc

- Migration versioned và transaction.
- Foreign key bật; restore chạy `integrity_check` và `foreign_key_check`.
- Job state chỉ thay đổi qua state machine, trừ recovery SQL có phạm vi rõ ràng khi app startup.
- Project duplicate không tái sử dụng `source_id` scoped của project cũ.
- JSON columns cần tiếp tục chuyển dần sang decoder Zod/safe parse; đây vẫn là hạng mục mở.

## Ownership tệp

Thư mục cache dành riêng có `.tubmedia-owned.json`:

```json
{
  "owner": "Tubmedia",
  "purpose": "download-temp",
  "createdAt": "ISO-8601",
  "version": 1
}
```

Cleanup đệ quy chỉ được phép khi marker hợp lệ. File được theo dõi riêng chỉ được xóa khi path nằm trong root an toàn.
