# Tubmedia FIX13 — Lag khi chạy nhiều danh sách: trần số danh sách / quy trình chạy cùng lúc (bước 1)

Phần 2 "lag khi tải 6 danh sách + edit" gồm 3 bước, mỗi bước một commit và duyệt riêng:
1. **(tài liệu này)** trần số danh sách tải / quy trình ghép chạy "full" cùng lúc + trần riêng YouTube 6 (hướng A kế hoạch 429);
2. bắt đầu dần — giới hạn số tác vụ nặng được bật trong cùng một lượt tick;
3. gộp các lần gửi cả danh sách tác vụ qua IPC và cho tick chỉ đọc tác vụ chưa xong.

## Đo trước khi sửa (2026-10-12)

- Mỗi danh sách tải tự dùng đủ `downloadWorkers` của hồ sơ, hoàn toàn độc lập: 6 danh sách × 4 luồng = **24 tiến trình yt-dlp**
  cùng lúc. Mỗi lần mở yt-dlp (bản PyInstaller phải giải nén) tốn **≈0,77 s CPU**; 24 cái cùng lúc = 18,5 s CPU trong 5 s.
- Ô "Tổng video tải đồng thời toàn ứng dụng" (`maxGlobalDownloadWorkers`) không còn được hàng đợi đọc từ bản 1.3.0 — ô chết.
- Quy trình ghép bị chặn theo TỔNG số video (`maxGlobalMergeJobs × downloadWorkers`), nên 6 quy trình vẫn cùng chạy, mỗi cái vài
  video — không đúng với nhãn "Đang cho phép N quy trình" trên trang Ghép theo Timeline.

## Cách sửa (đã xác nhận với người dùng)

- **Trần SỐ DANH SÁCH, không chia nhỏ luồng.** Mỗi danh sách / quy trình đang chạy vẫn dùng đủ luồng theo hồ sơ phần cứng
  (`downloadWorkers` không đổi). Danh sách / quy trình vượt trần **chờ lượt** và tự bắt đầu khi một cái khác xong.
- Một danh sách "giữ lượt" khi có ít nhất một tác vụ đang chạy trong làn đó (`laneSlotAvailable`, `src/shared/utils/queue-lane.ts`).
- **Ô mới "Số danh sách tải chạy cùng lúc"** (`maxConcurrentDownloadLists`, Cài đặt › Tải xuống, thay ô chết):
  0 = **tự động theo máy** (mặc định) — khuyến nghị phần cứng có sẵn: ≤8 lõi hoặc RAM trống ≤16 GB → 1, mạnh hơn → 2
  (`recommendedConcurrentLists`, đo lại mỗi phút vì RAM trống thay đổi); 1–6 = đúng số đã chọn. Lưu ngoài khối `app` để quay lui
  bản cũ không hỏng cài đặt.
- **Quy trình ghép** dùng chính `maxGlobalMergeJobs` (1–4, "Mức xử lý song song" trên trang Ghép theo Timeline): tối đa N quy trình
  chạy cùng lúc, mỗi quy trình đủ luồng tải — thay cho cách tính theo tổng số video. Danh sách tải và quy trình ghép có trần riêng,
  không chiếm lượt của nhau.
- **Trần riêng YouTube 6 video toàn ứng dụng** (cả làn ghép) — lưới an toàn chống HTTP 429, chạy song song với trần số danh sách
  (2 danh sách × 4 luồng vẫn ra 8 video YouTube).
- Thẻ danh sách / quy trình đang chờ hiện "Đang chờ lượt — đã có N danh sách tải chạy cùng lúc. Tự bắt đầu khi một danh sách xong."
  (`SystemStats.laneWaits`, thành phần `LaneWaitNotice`).

## Kiểm thử

- Unit `tests/unit/queue-lane.test.ts` (lượt, ô tự động, khuyến nghị phần cứng, trần YouTube), `tests/unit/stats-badge-refresh.test.ts`.
- Integration `tests/integration/queue-list-concurrency.test.ts` (`tick()` thật): 3 danh sách → A, B đủ 4 luồng, C chờ (mã cũ
  [4,4,4]); C chỉ vào khi A xong hẳn; ô tự động; 2 quy trình ghép → [4,0] (mã cũ [2,2]); danh sách và quy trình không chiếm lượt
  nhau; YouTube 6 (mã cũ 10), nền tảng khác không bị trần này.
- e2e "Lag bước 1" (yt-dlp thật, máy chủ cục bộ trả chậm): đặt 1 danh sách → danh sách 1 tải cả hai video cùng lúc, thẻ danh sách 2
  hiện "Đang chờ lượt" và không gửi yêu cầu nào tới khi danh sách 1 xong, rồi tự tải xong. Mã cũ: đỏ (không có ô cài đặt này).

## Ghi chú phát hành (đưa vào CHANGELOG.md khi bump phiên bản)

- Chạy nhiều danh sách cùng lúc không còn làm máy ì: Tubmedia chỉ cho một số danh sách tải chạy cùng lúc (mặc định theo cấu hình
  máy, chỉnh ở Cài đặt › "Số danh sách tải chạy cùng lúc"); mỗi danh sách đang chạy vẫn tải đủ số video cùng lúc như trước, danh
  sách còn lại hiện "Đang chờ lượt" và tự bắt đầu khi một danh sách xong. Quy trình ghép theo đúng "Mức xử lý song song": tối đa N
  quy trình chạy cùng lúc, mỗi quy trình chạy hết công suất.
- Thay ô "Tổng video tải đồng thời toàn ứng dụng" (đã không còn tác dụng từ bản 1.3.0) bằng ô "Số danh sách tải chạy cùng lúc".
- Tối đa 6 video YouTube tải cùng lúc trên toàn ứng dụng để giảm nguy cơ bị YouTube giới hạn (HTTP 429).
