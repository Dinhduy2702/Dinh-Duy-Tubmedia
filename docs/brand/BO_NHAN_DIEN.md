# Bộ nhận diện Tubmedia

Logo chuẩn là ảnh `logo-tubmedia.png` do chủ dự án cung cấp (thực chất là JPEG 1024×1024), được vẽ lại thành SVG thuần:
huy hiệu đỏ bo góc có nút play trắng, chữ **TUB** lớn, **MEDIA** nhỏ hơn bên dưới, thanh đen bo tròn ở dưới cùng.
Chữ đã chuyển thành đường vẽ; không phụ thuộc phông hay ảnh ngoài.

## Tệp

| Tệp | Nội dung |
|---|---|
| `docs/brand/svg/*.svg` | 11 bản đã duyệt: biểu tượng, ngang, dọc; màu (nền tối = chữ trắng, nền sáng = chữ đen), một màu trắng, một màu đen than |
| `docs/brand/tubmedia-logo.ico` | .ico đủ kích thước 16–256 px của biểu tượng. **Chưa dùng cho bộ cài/.exe**: icon bộ cài và .exe vẫn là `resources/icon.ico` |
| `src/renderer/src/brand/logo-data.ts` | Dữ liệu đường vẽ do máy sinh từ đúng các SVG trên (không sửa tay) |
| `src/renderer/src/components/TubmediaBrand.tsx` | Thành phần `TubmediaLogo` (biến thể `mark` / `horizontal` / `vertical`; tông `auto` / `on-dark` / `on-light` / `mono-white` / `mono-charcoal`) |
| `src/renderer/src/brand.css` | Màu logo và các lớp `.tm-logo-*`; nạp trước `tokens.css` |
| `src/renderer/public/tubmedia-icon.svg` | Favicon (biểu tượng trong khung 128×128) |
| `tests/unit/brand-logo.test.ts` | Đối chiếu dữ liệu ứng dụng với SVG đã duyệt, màu, quy tắc dùng, .ico |

## Màu (đo từ điểm ảnh của ảnh gốc)

| Vai trò | Mã |
|---|---|
| Đỏ logo | `#DB2B23` |
| Nút play | `#F9F9F9` |
| Chữ trắng (chỉ nền tối) | `#FAFAF9` |
| Đen logo (chữ/thanh trên nền sáng, bản một màu đen than) | `#262626` |
| Đen than giao diện (nền thanh bên) | `#1C1C1E` |

**Đỏ logo khác đỏ báo lỗi.** Đỏ báo lỗi là `#B3261E` (ΔE2000 = 8,4 so với đỏ logo, cùng sắc độ), luôn đi kèm biểu tượng ⊗ và nhãn "Lỗi".
Đỏ logo chỉ nằm trong ảnh logo; không dùng làm màu nhấn, viền, nút hay báo lỗi.

## Cách dùng

- Chữ trắng CHỈ trên nền tối; nền sáng dùng bản chữ đen. Nền xám: bản một màu (đỏ chỉ đạt 2,35:1 trên xám nhạt, 1,48:1 trên xám đậm).
- Không kéo giãn, không đổi màu, không bóng đổ hay hiệu ứng mờ.
- Vùng trống quanh logo: bằng chiều cao chữ MEDIA (khoảng ⅓ chiều cao huy hiệu).
- Cỡ tối thiểu: biểu tượng rộng 16 px; bản ngang cao 32 px; bản dọc cao 96 px (ước tính, chưa đo riêng). Nhỏ hơn thì dùng biểu tượng.

## Khác ảnh gốc (đã được duyệt)

Mép sắc nét và thẳng; khoảng cách chữ được làm đều (TUB 16,9/25,2 → 21,0/21,0 px trên ảnh 1024); trên nền tối thanh đen đổi sang trắng
(thanh đen biến mất trên nền tối); trên nền sáng chữ trắng đổi sang đen của logo. Độ lệch hình học so với ảnh gốc: khoảng cách hai đường viền
trung bình 0,14–0,41 px, lớn nhất 0,69–1,75 px trên 1024 px (không tính phần dịch chủ ý của chữ), IoU ≥ 0,963.

## Đổi icon bộ cài / .exe (chưa làm, cần đồng ý riêng)

Icon bộ cài và .exe lấy từ `resources/icon.ico` qua `package.json` (`win.icon`, `nsis.installerIcon`, `nsis.uninstallerIcon`).
Khi chủ dự án đồng ý, chỉ cần thay tệp đó bằng `docs/brand/tubmedia-logo.ico` (hoặc trỏ `package.json` sang tệp mới) rồi dựng lại bộ cài.
