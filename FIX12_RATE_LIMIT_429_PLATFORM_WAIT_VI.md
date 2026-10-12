# Tubmedia FIX12 — HTTP 429: nghỉ chung theo nền tảng rồi tự tiếp tục (hướng B)

Thuộc kế hoạch xử lý 429 đã duyệt ngày 2026-10-10: **A + B** trước (A = giới hạn chung theo nền tảng, B = nghỉ chung theo nền tảng
+ lùi dần + tự tiếp tục), **C** (giãn cách chủ động, giảm kết nối aria2c) làm sau. Tài liệu này chỉ gồm **B**; A và C là các
phần riêng.

## Vấn đề

- Dính HTTP 429 (`SourceRateLimitedError`, mã `SOURCE_RATE_LIMITED`) thì hàng đợi tạm dừng **đúng danh sách đó**
  (`pauseProjectForBlockingError`) và hiện thông báo đứng cố định — rồi chờ người dùng bấm "Tiếp tục" **vô thời hạn**.
- Các danh sách khác tải cùng nền tảng (cả làn tải của quy trình ghép) không biết gì, vẫn bắt đầu video mới, tiếp tục tiêu
  hạn ngạch chung của IP/cookies và lần lượt bị chặn theo dây chuyền — mỗi danh sách một thông báo.
- Bấm Tiếp tục thì danh sách chạy lại ngay với đủ số luồng, dễ bị chặn tiếp.

## Cách sửa

- **Nghỉ chung theo nền tảng** (`src/main/queue/platform-rate-limit-gate.ts`): một video dính 429 thì cả ứng dụng ngừng
  **bắt đầu** video mới của nền tảng đó ở mọi danh sách, kể cả làn ghép. Video đang tải dở vẫn chạy tiếp; nền tảng khác
  không bị ảnh hưởng. Nền tảng lấy theo `detectPlatform` (YouTube, TikTok…; nguồn lạ là tên miền).
- Video dính 429 **quay lại chờ** (không đốt lượt thử, không tạm dừng danh sách), dòng trạng thái
  "Đang chờ do giới hạn {nền tảng}".
- **Lùi dần, có ngẫu nhiên ±15%** (`src/shared/utils/rate-limit-backoff.ts`): 2 → 5 → 15 phút. Hết giờ thì tự tiếp tục với
  **1 video một lúc** của nền tảng đó, mỗi video tải xong thêm 1; đủ 6 thì bỏ hẳn giới hạn tạm và xóa chuỗi.
- **Sau 3 vòng tự tiếp tục vẫn bị chặn** (lần dính thứ 4 liên tiếp) thì **dừng hẳn** như trước: tạm dừng danh sách, thông
  báo đứng cố định nêu rõ đã tự thử 3 lần, chờ người dùng xác minh trên trình duyệt rồi bấm Tiếp tục (bấm Tiếp tục thì xóa
  trạng thái dừng của nền tảng).
- Video đang tải dở từ trước lúc nghỉ cũng dính 429 thì **không** tính thêm lần và không kéo dài thời gian chờ.
- Chuỗi tự xóa sau 2 giờ không dính 429.
- **Một thông báo cho mỗi nền tảng** (`rate-limit-{nền tảng}`, mức cảnh báo, tự ẩn), nêu giờ tự tiếp tục.
- **Huy hiệu ở thanh trên cùng** cạnh "Đang giảm tải": "Đang chờ do giới hạn YouTube · 4:12" (đếm ngược từng giây); dừng hẳn
  thì "Đã dừng do giới hạn YouTube" (tông lỗi).
- Không có bộ hẹn giờ nào: hàng đợi hỏi trạng thái nghỉ ở mỗi lượt tick, nên không có gì phải hủy khi người dùng bấm Tiếp tục
  hay khi ứng dụng đóng. Trạng thái chỉ nằm trong bộ nhớ (không đổi CSDL); mở lại ứng dụng thì bắt đầu lại bình thường.
- Sửa kèm: `setStats` ở giao diện từng bỏ qua bản thống kê mới khi CPU/RAM gần như không đổi mà không so trạng thái huy hiệu —
  "Đang giảm tải" (đã có từ trước) và huy hiệu 429 mới có thể không hiện/không tắt. Giờ so cả hai.

## So với PR #4 (phiên cloud)

PR #4 đề xuất backoff **theo từng danh sách** (hẹn giờ tự gọi `resumeProject`), 2 → 4 → 8 → 16 → 20 phút và **tự thử lại vô
hạn**. Đã thay theo kế hoạch gốc: nghỉ **theo nền tảng toàn ứng dụng** (chặn được dây chuyền giữa các danh sách), lịch 2 → 5 → 15
phút rồi **dừng hẳn**, tiếp tục với ít luồng rồi tăng dần, huy hiệu đếm ngược. Giữ ý `nextRateLimitStrikes` (cửa sổ xóa chuỗi
2 giờ) và cách làm tròn "khoảng N phút" của PR #4.

## Kiểm thử

- Unit: `tests/unit/rate-limit-backoff.test.ts`, `tests/unit/platform-rate-limit-gate.test.ts`,
  `tests/unit/stats-badge-refresh.test.ts`, `tests/unit/electron-fuses.test.ts` (biến e2e mới).
- Integration (`tests/integration/queue-rate-limit-platform-wait.test.ts`, `tick()`/`execute()` thật trên CSDL thật):
  nghỉ chặn cả danh sách khác và làn ghép, nền tảng khác vẫn chạy, tự tiếp tục 1 rồi 2 video; video đang tải dở cùng dính
  không tính thêm lần; lần thứ 4 dừng hẳn, bấm Tiếp tục thì tải lại.
- e2e "Hướng B 429" (yt-dlp thật, máy chủ cục bộ trả 429, thời gian nghỉ rút còn 4 giây qua
  `TUBMEDIA_E2E_RATE_LIMIT_WAIT_MS` — chỉ có tác dụng khi `TUBMEDIA_E2E=1` và chạy từ mã nguồn): mã cũ đỏ (tác vụ `paused`);
  mã mới xanh — huy hiệu đếm ngược, danh sách 2 không gửi yêu cầu nào trong lúc nghỉ, cả hai tự tải xong.

## Ghi chú phát hành (đưa vào CHANGELOG.md khi bump phiên bản)

`verify:version` yêu cầu CHANGELOG.md bắt đầu bằng đúng phiên bản hiện tại (1.6.3 — đã phát hành), nên ghi chú dưới đây được
đưa vào CHANGELOG ở bước `npm run bump` của đợt phát hành chứa bản sửa này:

- Khi nền tảng (ví dụ YouTube) giới hạn số yêu cầu (HTTP 429), Tubmedia không còn đứng im chờ bạn bấm Tiếp tục:
  - Cả ứng dụng tạm ngừng bắt đầu video mới của nền tảng đó ở mọi danh sách và quy trình ghép (video đang tải dở vẫn chạy
    tiếp, nền tảng khác không bị ảnh hưởng), thay vì để các danh sách khác tiếp tục gửi yêu cầu rồi lần lượt bị chặn.
  - Thanh trên cùng hiện "Đang chờ do giới hạn YouTube" kèm đồng hồ đếm ngược; chỉ một thông báo cho mỗi nền tảng.
  - Hết giờ chờ (2 phút, nếu bị chặn tiếp thì 5 rồi 15 phút) Tubmedia tự tiếp tục, lúc đầu từng video một rồi tăng dần.
  - Sau 3 lần tự thử mà vẫn bị chặn, Tubmedia dừng hẳn như trước và nhờ bạn mở video trong trình duyệt để xác minh rồi bấm
    Tiếp tục.
