# Tubmedia 1.2.0 FIX9

FIX9 sửa xung đột giữa ESLint và TypeScript trong `StatusBadge.tsx`.

- Không dùng non-null assertion không cần thiết.
- Vẫn bảo đảm hàm `statusColor()` luôn trả về `string`.
- Màu dự phòng giữ nguyên `#0ea5e9`.
- Script build chạy TypeScript trước, ESLint sau, rồi mới gọi build chính thức.
