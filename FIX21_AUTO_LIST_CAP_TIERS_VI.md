# FIX21 — "Tự động theo máy": số danh sách tải chạy cùng lúc chia nhiều mức theo lõi CPU + RAM trống

## Vì sao

Lag bước 1 (FIX13) đặt mặc định "tự động" chỉ 2 mức: ≤8 lõi hoặc RAM trống ≤16 GB → 1 danh sách, còn lại 2. Khi tự kiểm
PR #4 (2026-10-15), máy 36 lõi / 82 GB RAM trống chỉ chạy 2 danh sách nên tổng thời gian tải chậm gần gấp đôi bản cũ
(22,7–27,8 s so với 12,2–12,4 s, 23 video, mạng giả lập). Người dùng duyệt: chia nhiều mức theo cấu hình máy thật, đo lại
mỗi lần mở app.

## Quy tắc

Số danh sách = **mức nhỏ hơn** giữa mức theo số lõi logic và mức theo RAM CÒN TRỐNG:

| Mức | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Lõi logic | ≤4 | ≤8 | ≤12 | ≤16 | ≤24 | >24 |
| RAM trống | ≤8 GB | ≤16 GB | ≤24 GB | ≤32 GB | ≤48 GB | >48 GB |

- Hàng đợi đo lại lõi + RAM trống mỗi phút khi ô "Số danh sách tải chạy cùng lúc" để "Tự động theo máy" (như trước).
- Số "khuyến nghị" ở Cài đặt (`recommendDownloadConcurrency().recommendedConcurrentLists`, cũng là số trong ngoặc của
  "Tự động theo máy (N)") dùng CÙNG hàm → luôn trùng số hàng đợi dùng. Các câu tóm tắt bỏ phần nêu số danh sách cũ.
- Không đổi: trần riêng YouTube 6 video toàn app, cổng chờ 429 (hướng B), giãn nhịp (hướng C), bắt đầu dần 2 tác vụ /
  350 ms — thêm danh sách không làm tăng số video YouTube chạy song song.

## Kiểm tra

- Unit `queue-lane.test.ts`: từng mức theo lõi (RAM dư), từng mức theo RAM (lõi dư), máy tiêu biểu (yếu 1–2, trung bình
  3–4, rất mạnh 6), giá trị biên/không hợp lệ → luôn trong 1..6. `hardware-recommendation.test.ts`: số khuyến nghị trùng
  mức tự động ở 9 cấu hình. Mã cũ: đỏ.
- Đo thật (bản build của nhánh, mạng giả lập: trễ 300 ms, ~1 MB/s mỗi kết nối, 23 video thật MP4, 5 danh sách + thêm
  danh sách 6 giữa chừng, sửa/tạm dừng/tiếp tục/xoá trong lúc tải). Máy yếu/trung bình giả lập bằng giới hạn lõi
  (`start /affinity`) cho cả cụm tiến trình và đặt số danh sách đúng mức của cấu hình đó; máy mạnh để tự động thật:

| Cấu hình | Số danh sách | Tổng thời gian | Main khựng p95 / max | Lần >100 ms | UI khung max |
|---|---|---|---|---|---|
| Yếu (4 lõi) | 1 | 85,5–90,1 s | 40 / 78–306 ms | 0–2 | 33 ms |
| Trung bình (12 lõi) | 3 | 31,8–34,2 s | 27–33 / 52–108 ms | 0–1 | 18–33 ms |
| Mạnh (36 lõi, tự động) | 6 | 12,5–13,1 s | 47–67 / 137–145 ms | 1–2 | 17 ms |
| Bản trước lag 1–3 (không trần) | — | 12,2–12,4 s | 127–200 / 317–409 ms | 8–10 | 20 ms |
| PR #4 trước sửa này, tự động | 2 | 22,7–27,8 s | 23–24 / 58–70 ms | 0 | 19–53 ms |

Máy mạnh giờ nhanh ngang bản cũ mà vẫn ít khựng hơn nhiều; mọi lượt tải xong đủ 23/23.
