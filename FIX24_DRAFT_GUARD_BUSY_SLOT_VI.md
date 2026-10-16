# FIX24 — Phía main không cho lưu nháp đè lên danh sách / quy trình đang tải

## Vì sao

Tự kiểm PR #4 bằng mạng thật (2026-10-15): script gọi `saveDownloadDraft` với thư mục rỗng cho một danh sách đang chờ lượt →
3 video lỗi `ENOENT mkdir ''`. Bản nháp ghi đè thư mục nguồn/tạm/thành phẩm và thay toàn bộ link của danh sách, trong khi
các video đã xếp hàng vẫn đọc thư mục của danh sách đó. Giao diện đã khóa ô nhập khi danh sách đang chạy / tạm dừng (và
bỏ lượt tự lưu) nên người dùng thường không gặp, nhưng phía main không chặn — mọi lối khác (IPC, giao diện bị trễ trạng thái)
đều ghi đè được. `saveMergeDraft` cùng vấn đề.

## Sửa

- `WorkbenchService.saveDownloadDraft` / `saveMergeDraft`: danh sách / quy trình còn tác vụ ở trạng thái khóa ô nhập của
  giao diện (`pending`, `analyzing`, `downloading`, `retrying`, `normalizing`, `processing`, `verifying`, `merging`,
  `paused`, `interrupted`) thì:
  - bản nháp muốn ĐỔI tên/thư mục → từ chối, báo "Danh sách này đang tải hoặc đang tạm dừng (còn video chưa xong) nên
    chưa lưu được thay đổi…", không ghi gì (kể cả link, hồ sơ tài nguyên);
  - bản nháp KHÔNG đổi gì → bỏ qua, không báo lỗi: lượt tự lưu (trễ 800 ms) có thể bắn ngay sau khi người dùng bấm Tải
    với đúng giá trị nút Tải vừa lưu (kể cả thư mục tạm mặc định `_yt_tmp`).
- Danh sách chỉ còn tác vụ xong / lỗi / hủy, hoặc chưa có gì → lưu nháp như cũ.
- Cố ý KHÔNG khóa thêm các trạng thái trung gian (`ready`, `downloaded`): giao diện coi đó là rảnh và vẫn tự lưu — khóa ở
  main sẽ sinh báo lỗi vô cớ.

## Kiểm tra

- Integration `workbench-draft-busy-guard.test.ts` (WorkbenchService + QueueManager + CSDL thật): 5 trạng thái bận →
  từ chối, thư mục/link giữ nguyên; quy trình ghép đang chạy → từ chối; đang bận mà bản nháp không đổi → không lỗi, không
  ghi (cả danh sách tải lẫn quy trình ghép); chỉ còn tác vụ xong/lỗi/hủy → lưu như cũ; chưa có gì → tạo mới. Mã cũ: đỏ 8/10.
