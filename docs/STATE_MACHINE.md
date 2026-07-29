# Job State Machine

Nguồn chuẩn: `src/shared/utils/job-state-machine.ts`.

## Quy tắc chính

- `completed` và `skipped` là terminal.
- `resume` chỉ chấp nhận `paused` hoặc `interrupted`.
- `retry` chỉ chấp nhận `failed` hoặc `interrupted`.
- Job `analyze`, `normalize`, `verify` chưa có executor độc lập sẽ **failed rõ ràng**, không được completed giả.
- Repository kiểm tra transition trước khi ghi SQLite.
- Pause chỉ ghi `paused` sau khi lời gọi ProcessManager hoàn thành và job chưa chuyển terminal.

## Còn thiếu

- Trạng thái trung gian `pausing/resuming/cancelling` trong schema hiện tại.
- Sequence monotonic cho mọi event Renderer.
- Xác nhận process tree Windows qua Job Objects.
