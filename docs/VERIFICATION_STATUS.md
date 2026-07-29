# Verification Status — 27/07/2026

## Gates đã chạy trong môi trường hiện tại

| Gate | Trạng thái | Thời gian | Kết quả/bằng chứng |
|---|---|---:|---|
| `npm run check:assets` | PASS | 0,18 giây | 2 PNG, 1 ICO và 1 SVG hợp lệ |
| `npm run verify:release` | PASS | 0,10 giây | 49 kiểm tra source/release |
| `npm run verify:stable` | PASS | 0,13 giây | 49 kiểm tra release + 24 kiểm tra stable |
| `npm run verify:audit-hardening` | PASS | 0,10 giây | 27 kiểm tra tĩnh tập trung vào các lỗi audit |
| `npm run verify:audit-behavior` | PASS | 0,16 giây | 4 kiểm tra hành vi trực tiếp: không ghi đè, selector nguồn, selector merge độc lập, HDR Auto |
| Syntax-only probe cho file TypeScript thay đổi | PASS giới hạn | — | Không phát hiện lỗi parser `TS1xxx`; không thay thế typecheck đầy đủ |

## Gates bị chặn bởi môi trường

| Gate | Trạng thái | Thời gian | Lý do |
|---|---|---:|---|
| `npm ci --ignore-scripts --offline` | BLOCKED BY ENVIRONMENT | 0,67 giây | Registry sandbox không có cache `zustand-5.0.14` (`ENOTCACHED`) |
| `npm run typecheck` | BLOCKED BY ENVIRONMENT | 0,53 giây | Thiếu local type definitions `electron` và `node` do dependencies chưa cài |
| `npm run lint` | BLOCKED BY ENVIRONMENT | 0,07 giây | `eslint` chưa được cài |
| `npm run test` | BLOCKED BY ENVIRONMENT | 0,08 giây | `vitest` chưa được cài |
| `npm run test:integration` | BLOCKED BY ENVIRONMENT | 0,07 giây | `vitest` chưa được cài |
| `npm run build` | BLOCKED BY ENVIRONMENT | 0,55 giây | Dừng tại typecheck vì dependencies thiếu |

## Gates chưa được xác minh

| Phạm vi | Trạng thái | Môi trường cần thiết |
|---|---|---|
| Windows Job Objects/process tree pause-resume-cancel | NOT VERIFIED | Windows 10/11, yt-dlp, aria2c, FFmpeg thật |
| Media regression và packet/stream hash | NOT VERIFIED | FFmpeg/ffprobe và bộ fixture SDR/HDR/VFR/rotation/SAR |
| Electron UI visual matrix | NOT VERIFIED | Windows GUI, Playwright Electron, scaling 100/125/150% |
| Installer clean/upgrade/uninstall/reinstall | NOT VERIFIED | Windows VM sạch, code signing/release identity thật |
| Tải đa nền tảng thực tế | NOT VERIFIED | Mạng ngoài, cookies/proxy/test URLs hợp lệ |

Không mục `BLOCKED BY ENVIRONMENT`, `NOT VERIFIED` hoặc `PASS giới hạn` nào được coi là PASS đầy đủ cho phát hành.
