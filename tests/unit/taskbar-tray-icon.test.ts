import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Icon taskbar/khay hệ thống: đổi theo yêu cầu và sự đồng ý RIÊNG của người dùng (2026-09-22) —
// ngoại lệ có chủ đích cho quy tắc "không đổi icon bộ cài/.exe khi chưa hỏi riêng", chỉ áp dụng việc này.
// Biểu tượng lấy từ mark đã duyệt ở GĐ 1b, hint riêng từng cỡ (xem C:\Users\Hi\Tubmedia-anh-so-sanh\logo\chuan\icon-taskbar\THONG-SO-ICON.md).
const root = process.cwd();
const text = (path: string): string => readFileSync(join(root, path), 'utf8');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EXPECTED_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function parseIco(buffer: Buffer): Array<{ size: number; bitCount: number; format: 'PNG' | 'DIB'; dib?: { biWidth: number; biHeight: number; biBitCount: number }; pngSize?: [number, number] }> {
  expect(buffer.readUInt16LE(0)).toBe(0);
  expect(buffer.readUInt16LE(2)).toBe(1);
  const count = buffer.readUInt16LE(4);
  const layers = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const size = buffer[entry] === 0 ? 256 : (buffer[entry] ?? 0);
    const bitCount = buffer.readUInt16LE(entry + 6);
    const byteSize = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    expect(offset + byteSize, `lớp ${size}px vượt quá tệp`).toBeLessThanOrEqual(buffer.length);
    const isPng = buffer.subarray(offset, offset + 8).equals(PNG_SIGNATURE);
    if (isPng) {
      layers.push({ size, bitCount, format: 'PNG' as const, pngSize: [buffer.readUInt32BE(offset + 16), buffer.readUInt32BE(offset + 20)] as [number, number] });
    } else {
      layers.push({
        size,
        bitCount,
        format: 'DIB' as const,
        dib: { biWidth: buffer.readInt32LE(offset + 4), biHeight: buffer.readInt32LE(offset + 8), biBitCount: buffer.readUInt16LE(offset + 14) }
      });
    }
  }
  return layers;
}

describe('icon.ico / icon.png — thanh tác vụ và khay hệ thống (đã duyệt, thay resources/)', () => {
  const ico = readFileSync(join(root, 'resources/icon.ico'));
  const png = readFileSync(join(root, 'resources/icon.png'));

  it('đủ 9 lớp 16…256px, 32-bit có alpha; lớp <256 là DIB đúng khuôn Windows, lớp 256 là PNG', () => {
    const layers = parseIco(ico);
    expect(layers.map((layer) => layer.size).sort((a, b) => a - b)).toEqual(EXPECTED_SIZES);
    for (const layer of layers) {
      expect(layer.bitCount, `${layer.size}px phải 32-bit`).toBe(32);
      if (layer.size >= 256) {
        expect(layer.format).toBe('PNG');
        expect(layer.pngSize).toEqual([256, 256]);
      } else {
        expect(layer.format).toBe('DIB');
        expect(layer.dib).toEqual({ biWidth: layer.size, biHeight: layer.size * 2, biBitCount: 32 });
      }
    }
  });

  it('icon.png là ảnh gốc lớn 1024×1024, RGBA (nền trong suốt)', () => {
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png[25]).toBe(6); // colorType 6 = RGBA
  });

  it('cửa sổ chính và khay hệ thống đọc icon.ico (không còn resize() một ảnh lớn cho khay)', () => {
    const mainWindow = text('src/main/windows/main-window.ts');
    expect(mainWindow).toContain("join(app.getAppPath(), 'resources', 'icon.ico')");
    expect(mainWindow).not.toContain('icon.png');

    const index = text('src/main/index.ts');
    expect(index).toContain("nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.ico'))");
    expect(index).not.toContain('.resize(');
    expect(index).not.toContain('icon.png');
  });

  it('package.json KHÔNG đổi: vẫn 3 chỗ trỏ "resources/icon.ico" và extraResources vẫn "resources/icon.png" (chỉ đổi nội dung tệp, không đổi đường dẫn/tên)', () => {
    const pkg = text('package.json');
    expect(pkg.match(/"resources\/icon\.ico"/g)).toHaveLength(3); // win.icon, nsis.installerIcon, nsis.uninstallerIcon
    expect(pkg).toContain('"from": "resources/icon.png"');
    expect(pkg).toContain('"to": "icon.png"');
  });

  it('kiểm tra tài sản (check:assets) xác nhận đủ lớp — không chỉ tin việc ghi tệp không báo lỗi', () => {
    // scripts/validate-assets.mjs đọc lại tiêu đề .ico (giống parseIco ở trên) và chạy trong `npm run check`.
    const validator = text('scripts/validate-assets.mjs');
    expect(validator).toContain('EXPECTED_ICO_SIZES');
    expect(validator).toMatch(/missing\.length.*thiếu lớp/s);
  });
});
