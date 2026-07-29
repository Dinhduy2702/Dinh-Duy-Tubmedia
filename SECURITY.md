# Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Preload chỉ expose API đã định nghĩa.
- IPC validate Zod và kiểm tra sender.
- Không `shell: true`, không command tùy ý từ Renderer.
- CSP chặn remote script/object/frame.
- Navigation và window mới bị chặn; link HTTPS mở qua shell có kiểm soát.
- Structured logger redaction cookie, token, password và Authorization.
- Tool update bắt buộc HTTPS + SHA-256 + staging + rollback.
