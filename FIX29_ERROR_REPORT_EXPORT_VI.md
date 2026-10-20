# FIX29 — Nút "Xuất báo cáo lỗi" (2026-10-20)

## Vì sao

Vụ MERGE_FAILED 2026-10-15 (job `03002b08`, NA361): hậu kiểm thành phẩm chỉ báo "lỗi giải mã gần 11:05", không nói nguồn nào
hỏng. Phải soạn hai khối lệnh PowerShell cho khách chạy (SHA256, giải mã lại từng nguồn và bản đệm, phiên bản/nguồn gốc
ffmpeg) mới tìm ra bản đệm chuẩn hóa của NA361 hỏng tiếng do ffmpeg 8.0 chép tay vào `tools\current`. Khách không phải dân kỹ
thuật; nút này làm thay toàn bộ việc gom đó trong một lần bấm.

## Hành vi

Trang **Lịch sử** → dòng "Có lỗi" / "Bị gián đoạn" → **Xuất báo cáo lỗi** → chọn nơi lưu (mặc định Tài liệu,
`Tubmedia-bao-cao-loi-<danh sách>-<mã tác vụ>-<ngày giờ>.zip`). Chạy nền ở tiến trình chính; dòng đó hiện tiến độ
("Đang kiểm tệp 3/8") và nút **Hủy**; xong thì có **Mở thư mục**. Rời trang rồi quay lại vẫn thấy tiến độ. Mỗi lúc chỉ một lượt.

Tệp .zip (không kèm video):

| Mục | Nội dung |
|---|---|
| `tom-tat.txt` | Phiên bản app, tác vụ, câu lỗi, ffmpeg (phiên bản · bản đi kèm hay `managed` · đường dẫn), và MỖI tệp đã kiểm: `sạch` / `HỎNG HÌNH` / `HỎNG TIẾNG` / `KHÔNG CÒN TRÊN Ổ` kèm câu lỗi ffmpeg |
| `bao-cao.json` | Như trên, đầy đủ: máy, công cụ + metadata `.vdmsp-tool-metadata.json` của bản `managed`, tác vụ, bản ghi `JOB_FAILED` (chi tiết lỗi: thời điểm, nguồn số mấy, đường dẫn tệp cách ly), danh sách; từng tệp: dung lượng, ngày sửa, SHA256, thông số luồng, kết quả giải mã hình/tiếng |
| `nhat-ky/tac-vu.jsonl` | Nhật ký của đúng tác vụ (cũ → mới) |
| `nhat-ky/danh-sach.jsonl` | Nhật ký của danh sách (gồm các tác vụ tải liên quan) |

Tệp được kiểm: tác vụ **ghép** → **mọi** video đang bật của danh sách (nguồn + tệp cắt) và bản đệm chuẩn hóa/remux của từng
video (`<thư mục tạm>\_normalized-cache`, `_remux-cache`; bỏ tệp `.pending`); tác vụ khác → đúng video của tác vụ. Mỗi tệp
được **giải mã lại toàn bộ** hình và tiếng (`-xerror -err_detect explode`), không chỉ nguồn được nêu trong lỗi — vì lỗi hậu
kiểm không chỉ ra nguồn (người dùng chốt 2026-10-20).

Bí mật (cookies, mã thông báo…) được che bằng `redactSecrets` như "Gói chẩn đoán". Hủy giữa chừng → không để lại tệp
(ghi `.part` rồi mới đổi tên). Bỏ ở bản này (người dùng chốt): đoạn video ~1 phút quanh chỗ lỗi.

## Mã

- `src/main/files/zip-writer.ts`: ghi zip (deflate, tên UTF-8) bằng `zlib` có sẵn — app chưa có thư viện tạo zip.
- `src/main/diagnostics/error-report.ts`: gom báo cáo (`collectErrorReport`) + `ErrorReportService` (chạy nền, tiến độ,
  hủy, mỗi lúc một lượt).
- IPC `error-report:start|status|cancel|reveal` (`reveal` chỉ mở đúng tệp của lượt đã xong, không nhận đường dẫn từ giao
  diện); `ErrorReportButton` trên trang Lịch sử.

## Kiểm tra

- Unit `zip-writer.test.ts`: zip giải nén được bằng `@tubmedia/safe-extract-zip` (yauzl, kiểm CRC + kích thước), tên tiếng
  Việt, có nén thật; từ chối tên nguy hiểm/trùng. Thử tay thêm: `Expand-Archive` và `tar` của Windows mở được.
- Integration `error-report.test.ts` (ffmpeg thật, dựng đúng kiểu vụ NA361: nguồn sạch, bản đệm chuẩn hóa hỏng tiếng): báo
  cáo chỉ ra `#2 [bản đệm chuẩn hóa] …: HỎNG TIẾNG`, nguồn `sạch`, nguồn đã xóa `KHÔNG CÒN TRÊN Ổ`; SHA256 đúng; che bí
  mật; bỏ `.pending`; dịch vụ ghi zip giải nén được; hủy giữa lúc giải mã → `cancelled`, không còn tệp.
- e2e Lịch sử: bấm nút trên dòng lỗi thật → .zip (tự thêm đuôi), giải nén được, có `JOB_FAILED`, mã lỗi, danh sách công cụ.
