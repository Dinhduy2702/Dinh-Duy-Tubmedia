# Phát triển

- Node.js LTS tương thích Electron.
- TypeScript strict, không `any`, không SQL trong React.
- Mỗi thay đổi domain phải có unit test.
- Mỗi migration chỉ tăng version; không sửa migration đã phát hành.
- Không nâng dependency major nếu chưa chạy `npm run check`.
- Process phải chạy `shell: false`, argument là từng phần tử riêng.
- Không log cookies, token, Authorization hoặc URL có credential.

## Quy ước commit

`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `build:`, `chore:`.
