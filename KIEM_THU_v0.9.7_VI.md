# KIỂM THỬ TUBMEDIA v0.9.7

## Lỗi đã sửa

Tác vụ ghép dừng ở 65% sau khi hiện `Đã chuẩn hóa video 4/4`, với lỗi:

```text
Các file vẫn chưa tương thích concat: Video 3: Profile: Main ≠ High
```

H.264 Main và High là metadata profile của cùng codec H.264. v0.9.6 chặn quá nghiêm dù các thuộc tính ghép quan trọng đã tương thích.

## Cách thử

1. Chạy `npm.cmd install`.
2. Chạy `npm.cmd run typecheck`.
3. Chạy `npm.cmd run test -- --run tests/unit/concat.test.ts`.
4. Chạy `npm.cmd run dev`.
5. Mở lại pipeline lỗi và bấm Thử lại/Tiếp tục.

Kết quả mong đợi: nếu chỉ khác Profile/Level, app không chuẩn hóa lại và chuyển nhanh sang ghép `-c copy`.
