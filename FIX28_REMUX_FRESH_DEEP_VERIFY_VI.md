# FIX28 — Tệp vừa remux phải giải mã toàn bộ hình + tiếng (2026-10-20)

## Lỗ hổng (còn lại sau FIX18)

FIX18 bắt bản đệm remux **lấy lại** phải giải mã toàn bộ, nhưng tệp **vừa remux** (`NormalizeEngine.remuxForConcat`) chỉ
được kiểm `standard` — 3 khung hình, không giải mã tiếng. Remux là chép luồng (`-c copy`), nên gói hỏng của nguồn đi thẳng
sang tệp remux.

Ở bước "chuẩn hóa timestamp" của `MergeEngine` (nguồn khớp thông số nhưng cần đưa timebase về 1/90000), tệp remux **thay
chỗ** nguồn. Bước "kiểm tra toàn bộ nguồn stream-copy" chỉ xét tệp còn giữ đường dẫn gốc → **cả nguồn lẫn tệp remux đều
không được giải mã toàn bộ**. Tiếng hỏng lọt tới tận hậu kiểm thành phẩm (cùng kiểu với vụ MERGE_FAILED 2026-10-15) —
sau khi đã tốn công ghép, và câu lỗi chỉ ra thời điểm trong thành phẩm chứ không chỉ ra video nguồn.

Tái hiện (integration, ffmpeg thật): nguồn có 40 gói AAC hỏng giữa tệp → mã cũ remux xong trả về tệp, ghi thành bản đệm.

## Sửa

- `remuxForConcat`: tệp vừa remux kiểm mức `deep` (giải mã toàn bộ hình + tiếng, `-xerror -err_detect explode`).
  Không qua → log `REMUX_FRESH_REJECTED` (kèm câu lỗi ffmpeg), cách ly, báo lỗi nêu **tên video nguồn** (remux chép nguyên
  luồng nên lỗi nằm ở nguồn). Không thành bản đệm.
- Tạm dừng/hủy giữa lúc kiểm → dừng, **không** cách ly (chưa chứng minh là hỏng), chỉ xóa tệp tạm.
- Tham số `sourceDecodeVerified`: nhánh "concat trực tiếp chưa phù hợp → remux" của `MergeEngine` chỉ chạy khi không cần
  chuẩn hóa, lúc đó mọi nguồn vừa qua "kiểm tra toàn bộ nguồn" → giữ mức `standard`, không giải mã lần hai. Nhánh chuẩn hóa
  timestamp và nhánh sửa timestamp kiểm `deep`.
- Chi phí: thêm một lượt giải mã (không mã hóa) cho mỗi tệp remux ở nhánh chuẩn hóa timestamp — đúng bằng lượt mà nguồn
  stream-copy vẫn phải chịu; nhánh sửa timestamp (hiếm) giải mã thêm một lần.

## Kiểm tra

- Integration `remux-fresh-deep-verify.test.ts` (ffmpeg thật): nguồn hỏng tiếng → chặn + cách ly, không có bản đệm (mã cũ:
  đỏ, trả về tệp); nguồn sạch → kiểm `deep`, lần sau `REMUX_CACHE_HIT` (mã cũ: đỏ, `standard`); `sourceDecodeVerified` →
  `standard`; hủy lúc kiểm → dừng, không cách ly, không sót tệp (mã cũ: đỏ).
- Unit `merge-remux-verify-level.test.ts`: trong 3 chỗ gọi `remuxForConcat` của `MergeEngine`, chỉ nhánh sau "kiểm tra
  toàn bộ nguồn" được bỏ kiểm deep.

## Chưa làm (ghi nhận)

- Bản chuẩn hóa chỉ mã hóa lại tiếng (`-c:v copy`) không giải mã lại luồng hình đã chép: hỏng hình ở nguồn vẫn chỉ bị chặn ở
  hậu kiểm thành phẩm.
