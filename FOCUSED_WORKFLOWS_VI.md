# Hai workflow cốt lõi

## 1. Tải linh động 1–4 danh sách

Màn hình **Tải nhiều danh sách** cho phép thêm hoặc bớt từ 1 đến 4 list. Mỗi list có:

- Ô dán link hoặc import TXT.
- Thư mục lưu video riêng.
- Thư mục tạm riêng.
- Resource Profile và số worker riêng.
- Nút Start, Pause, Resume, Cancel, Retry và Open Folder.
- Tiến trình, số file hoàn tất, speed và trạng thái riêng.
- Thẻ lỗi riêng cho cookies, tool, ổ đĩa, quyền thư mục hoặc mạng/CDN.
- Khung log riêng, không xen sự kiện từ list khác.

Scheduler chia lượt round-robin theo project/list. Mỗi list tôn trọng worker riêng nhưng tổng số download không vượt giới hạn toàn ứng dụng. Source trùng được khóa theo source identity; app tải một lần rồi hard-link/copy sang thư mục list còn lại sau khi kiểm tra.

### Chất lượng tải

Trang **Cài đặt > Tải xuống** cho phép đặt:

- Resolution min/max.
- FPS min/max.
- Video bitrate min/max.
- Audio bitrate min/max.
- Codec ưu tiên và container.
- Strict hoặc cho phép fallback khi nguồn dưới mức tối thiểu.
- Deep verification để giải mã toàn bộ file sau tải.
- Chế độ CapCut trực tiếp SDR 1080p hoặc 1080p–2K/1440p; không cần Proxy trong CapCut.

Cookies có thể thêm từ file Netscape hoặc Chrome/Edge/Firefox. Khi cần đăng nhập, chỉ list liên quan Pause và có nút thêm cookies ngay trên thẻ lỗi.

## 2. Tải và ghép

Màn hình **Tải & Ghép** có:

- Danh sách link; thứ tự dòng là thứ tự ghép.
- Source folder, temp folder và output folder.
- Tên thành phẩm.
- Quality Profile.
- Resource Profile.
- Lựa chọn xuất thêm `timeline.txt` (mặc định tắt).

Pipeline:

```text
Parse URL/note/timestamp
→ nhận diện source
→ tải source duy nhất
→ verify file thật
→ cắt/mute clip nếu dòng có timestamp hoặc yêu cầu mute
→ ffprobe toàn bộ input
→ concat-copy nếu tương thích
→ nếu lệch: chỉ normalize file lệch chuẩn
→ concat-copy
→ verify pending
→ backup final cũ
→ atomic rename
→ timeline trên giao diện + nút Copy mốc 00:00 Ph
→ chỉ xuất timeline.txt khi user bật lựa chọn
→ dọn tệp xử lý tạm sau khi hoàn tất
```

## Profile khuyến nghị cho máy hiện tại

Máy 2 × Xeon E5-2696 v3, 72 logical processors, RAM 128 GB, GTX 1060 3 GB, SSD 256 GB và HDD 1 TB:

```text
Resource Profile: Interactive Workstation
Bình thường: 2 list × 2 worker, tổng 4
Deep verification: tổng khoảng 2–3 worker
Normalize workers: 1
FFmpeg threads: 8
Filter threads: 4
Filter complex threads: 4
Priority: Below Normal
GPU jobs: 1
```

Nên để temp trên SSD nếu còn đủ dung lượng; source/output lớn trên HDD. Chỉ tăng tổng worker lên 6–8 khi mạng ổn định và ổ lưu không đạt 100% Active Time.


## Cập nhật v0.4.0

- 1–4 danh sách tải độc lập và 1–4 pipeline tải-ghép độc lập.
- Mỗi khu vực có nút điều khiển theo trạng thái, progress/log riêng và chức năng dọn lịch sử.
- Cookies hỗ trợ trình duyệt, dán trực tiếp và file TXT.
- Lỗi quan trọng hiển thị bằng cảnh báo tiếng Việt nổi bật; chi tiết kỹ thuật được thu gọn.
- Menu native đã được gỡ; giao diện có loading state, animation và phản hồi cho thao tác chính.
