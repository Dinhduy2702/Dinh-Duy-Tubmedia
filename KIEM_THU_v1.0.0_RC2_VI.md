# KIỂM THỬ TUBMEDIA 1.0.0-RC.2

1. `npm.cmd run verify:release` phải đạt toàn bộ kiểm tra.
2. `npm.cmd run typecheck` không có lỗi.
3. `npm.cmd run test` phải đạt toàn bộ unit test.
4. `npm.cmd run test:integration` phải đạt 15/15.
5. `npm.cmd run dev` phải mở giao diện, không còn lỗi named export `autoUpdater`.
6. Trong dev mode, Trung tâm cập nhật hiển thị cập nhật chỉ hoạt động ở bản đã cài đặt.
7. Sau khi build NSIS, kiểm tra chức năng cập nhật trên kênh beta.
