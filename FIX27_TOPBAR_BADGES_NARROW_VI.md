# FIX27 — Huy hiệu đếm ngược 429 / "Đang giảm tải" biến mất khi cửa sổ hẹp (2026-10-16)

## Hiện tượng

Lượt Publish #35 (run 38877098483, phát hành 1.7.0) trượt ở bài e2e "Hướng B 429" — lần đầu bài này chạy tới trên CI (các
lượt trước dừng sớm hơn). Huy hiệu `[data-rate-limit-platform]` có trong DOM, chữ đếm ngược chạy đúng, nhưng Playwright báo
"hidden" suốt 5 giây.

## Nguyên nhân gốc (lỗi thật của app)

Huy hiệu "Đang chờ do giới hạn …" và "Đang giảm tải" nằm BÊN TRONG thẻ CPU (`.topbar-cpu-card`). Ở cửa sổ ≤ 1180 px
(`tubmedia-theme.css`: `@media (max-width: 1180px) { .topbar-cpu-card { display: none } }`) thẻ CPU bị ẩn → ẩn luôn cả
hai huy hiệu. Máy CI có màn hình 1024×768 nên cửa sổ hẹp hơn 1180 px; người dùng màn 1024 px hoặc ghép cửa sổ nửa màn hình
1920 px (960 px) cũng không thấy app đang tự nghỉ vì 429 hay đang giảm tải. Máy dev màn rộng nên e2e luôn qua.

Phụ: khi nằm trong thẻ CPU, huy hiệu bị `.topbar-cpu-card span` (độ ưu tiên cao hơn) đè thành chữ xám nhạt cỡ nhỏ — màu
cảnh báo (và màu lỗi khi "Đã dừng do giới hạn") chưa bao giờ hiện đúng thiết kế.

## Sửa

- `Topbar.tsx`: chuyển hai huy hiệu ra khối riêng `.topbar-status-badges`, cạnh thẻ CPU trong `.topbar-metrics` (khối này
  vẫn hiện ở ≤ 1180 px). Không có huy hiệu thì khối tự ẩn (`:empty`).
- `tubmedia-theme.css`: kiểu cho `.topbar-status-badges`. Huy hiệu giờ hiện đúng màu cảnh báo/lỗi đã thiết kế.
- Test: bài e2e "Hướng B 429" thu cửa sổ về 1100×700 trước khi kiểm huy hiệu — đỏ với bản cũ ("hidden", đúng lỗi CI),
  xanh sau sửa.
