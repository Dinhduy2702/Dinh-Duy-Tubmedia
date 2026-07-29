# Video Download & Merge Studio Pro v0.2.1

## Mục tiêu của bản sửa

Bản này xử lý ba vấn đề thực tế của màn hình **Tải 2 danh sách**:

1. Không biến toàn bộ danh sách thành hàng chục lỗi khi thiếu tool hoặc khi một video cần đăng nhập/cookies.
2. Cho phép chỉnh số video tải đồng thời thay vì cố định 2 worker.
3. Phân tích cấu hình máy và áp dụng mức worker/fragment/aria2c phù hợp để Windows vẫn phản hồi tốt.

## Luồng cookies mới

- Không bắt buộc cookies trước khi tải, vì phần lớn video công khai không cần cookies.
- Khi yt-dlp xác định video cần đăng nhập, private, members-only, age-restricted hoặc xác minh bot:
  - job hiện tại chuyển sang **Pause**;
  - các job chưa chạy trong cùng danh sách cũng chuyển sang **Pause**;
  - các process đang chạy trong danh sách được tạm dừng;
  - giao diện hiện banner **Cần cookies**;
  - Windows hiện notification;
  - người dùng có thể chọn `cookies.txt` hoặc Chrome/Edge/Firefox;
  - sau khi lưu cookies, app xóa trạng thái lỗi chặn và tiếp tục queue.

## Worker tải đồng thời

- Mỗi danh sách A/B có ô **Video tải cùng lúc**, từ 1 đến 16.
- Có thêm giới hạn **Tổng video tải đồng thời toàn ứng dụng**, từ 1 đến 16.
- Scheduler chia lượt công bằng giữa A và B.
- Số fragment của từng video được tách riêng khỏi số worker.
- Không nên tăng đồng thời cả worker, fragment và kết nối aria2c.

## Khuyến nghị cho máy 72 logical CPU / 128 GB RAM

Cấu hình mặc định ưu tiên độ mượt:

- 2 worker cho A và 2 worker cho B.
- Tổng tối đa 4 video đồng thời.
- Khi chỉ chạy một danh sách: có thể dùng 4 worker.
- Fragment mỗi video: 2.
- Kết nối aria2c mỗi video: 6.
- Mức tối đa nên thử: 6–8 worker tổng, chỉ khi mạng ổn định và ổ đĩa không đạt 100% Active Time.
- FFmpeg threads: 8; normalize worker: 1; process priority: Below Normal.

## 45 lỗi cũ

Sau khi áp dụng patch, nút chính sẽ hiện **Xóa lỗi cũ & chạy lại** khi queue cũ còn failed jobs. Bấm nút này sẽ chạy preflight trước, sau đó xóa queue cũ và tạo queue mới. Thiếu tool sẽ bị chặn trước khi tạo hàng chục job.

## Kiểm tra bắt buộc

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
```

Sau khi tất cả hoàn tất:

```powershell
npm.cmd run dev
```
