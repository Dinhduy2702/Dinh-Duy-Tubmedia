# Nút thu nhỏ (—) luôn thu nhỏ xuống thanh tác vụ (2026-10-21)

## Vì sao

Bản cài 1.7.0, 2026-10-20: công tắc "Nút thu nhỏ (—) ẩn xuống khay hệ thống" đang bật → bấm "—" thì cửa sổ biến mất khỏi
thanh tác vụ, người dùng tưởng app đã đóng hẳn. Thực ra app vẫn chạy ẩn ở khay (tiến trình còn sống, `shutdown.log` không
có lần thoát nào); lời nhắc "Tubmedia vẫn đang chạy" chỉ hiện một lần duy nhất (máy người dùng: 09/10) nên các lần sau
không có gì báo.

## Hành vi (người dùng chốt)

- Nút **—** luôn để Windows thu nhỏ bình thường xuống thanh tác vụ, như mọi app — dù công tắc bật hay tắt.
- Công tắc (nhãn mới: **"Hiện biểu tượng ở khay hệ thống khi thu nhỏ (—)"**) chỉ thêm biểu tượng Tubmedia ở khay; bấm
  biểu tượng vẫn mở lại cửa sổ, chuột phải → "Thoát an toàn" như cũ. Giá trị đã lưu (`minimizeToTray`) giữ nguyên.
- Chỉ nút **X** mới ẩn hẳn cửa sổ xuống khay, và chỉ khi ô "Khi đóng ứng dụng" = "Thu nhỏ xuống khay hệ thống" (không
  đổi so với 1.6.0).
- Bỏ lời nhắc lần đầu (`consumeTrayMinimizeHint`, sự kiện `TRAY_MINIMIZE_HINT_SHOWN`): cửa sổ không còn biến mất khi
  thu nhỏ nên không còn gì để nhắc. Dòng `tray_minimize_hint_shown` cũ trong CSDL vô hại, để nguyên (quay lui an toàn).

## Mã

- `src/main/app/window-close-policy.ts`: `decideMinimizeAction` → `'minimize-with-tray-icon' | 'default'`.
- `src/main/index.ts`: sự kiện `minimize` chỉ gọi `ensureTray()`, không `window.hide()`.
- `src/main/settings/settings-service.ts`: bỏ `consumeTrayMinimizeHint`.
- `SettingsPage.tsx`: nhãn công tắc.

## Kiểm tra

- Unit `window-close-policy.test.ts`: chính sách mới; canh mã nguồn — nhánh thu nhỏ có `ensureTray()`, không `.hide()` /
  `setSkipTaskbar`; nhãn công tắc mới.
- e2e "Nút thu nhỏ (—) khi bật công tắc khay": bật công tắc qua IPC thật, `minimize()` → cửa sổ thu nhỏ, KHÔNG phát sự
  kiện `hide`, app không thoát, khôi phục được. Đỏ trên mã cũ (cửa sổ bị ẩn), xanh trên mã mới. (Không đo bằng
  `isVisible()`: Electron trên Windows trả `false` cho mọi cửa sổ đang thu nhỏ.)
- Bỏ `tests/integration/tray-minimize-hint.test.ts` (tính năng nhắc lần đầu đã bỏ).
