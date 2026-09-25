import { Buffer } from 'node:buffer';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function validatePng(path) {
  const data = await readFile(path);
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${path}: chữ ký PNG không hợp lệ.`);
  }

  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < data.length) {
    if (offset + 12 > data.length) throw new Error(`${path}: chunk PNG bị cắt ở byte ${offset}.`);
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length) throw new Error(`${path}: dữ liệu PNG bị thiếu ở byte ${offset}.`);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const payload = data.subarray(offset + 4, offset + 8 + length);
    const expected = data.readUInt32BE(offset + 8 + length);
    const actual = crc32(payload);
    if (actual !== expected) throw new Error(`${path}: checksum ${type} không khớp.`);
    if (type === 'IHDR') sawHeader = true;
    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') {
      sawEnd = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!sawHeader || !sawImageData || !sawEnd) throw new Error(`${path}: thiếu chunk PNG bắt buộc.`);
  if (offset !== data.length) throw new Error(`${path}: có dữ liệu thừa sau IEND.`);
}

// icon.ico dùng cho cửa sổ, taskbar VÀ khay hệ thống: phải có đủ các lớp đã hint riêng từng cỡ
// (16/20/24/32/40/48/64/128/256), mỗi lớp đúng kích thước/độ sâu màu, để Windows chọn đúng khung sắc nét
// theo tỉ lệ hiển thị thay vì thu nhỏ một ảnh lớn.
const EXPECTED_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

async function validateIco(path) {
  const data = await readFile(path);
  if (data.length < 22 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${path}: header ICO không hợp lệ.`);
  }
  const count = data.readUInt16LE(4);
  if (data.length < 6 + count * 16) throw new Error(`${path}: bảng ảnh ICO bị thiếu.`);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = data[entry] === 0 ? 256 : data[entry];
    const height = data[entry + 1] === 0 ? 256 : data[entry + 1];
    const bitCount = data.readUInt16LE(entry + 6);
    const byteSize = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    if (width !== height) throw new Error(`${path}: lớp ${width}x${height} không vuông.`);
    if (bitCount !== 32) throw new Error(`${path}: lớp ${width}px không phải 32-bit (có alpha).`);
    if (offset + byteSize > data.length) throw new Error(`${path}: lớp ${width}px vượt quá kích thước tệp.`);
    const isPng = data.subarray(offset, offset + 8).equals(PNG_SIGNATURE);
    if (width >= 256) {
      if (!isPng) throw new Error(`${path}: lớp 256px phải là PNG.`);
      const ihdrWidth = data.readUInt32BE(offset + 16);
      const ihdrHeight = data.readUInt32BE(offset + 20);
      if (ihdrWidth !== 256 || ihdrHeight !== 256) throw new Error(`${path}: PNG 256px có IHDR ${ihdrWidth}x${ihdrHeight}.`);
    } else {
      if (isPng) throw new Error(`${path}: lớp ${width}px không được là PNG (phải là DIB).`);
      const biWidth = data.readInt32LE(offset + 4);
      const biHeight = data.readInt32LE(offset + 8);
      const biBitCount = data.readUInt16LE(offset + 14);
      if (biWidth !== width || biHeight !== height * 2 || biBitCount !== 32) {
        throw new Error(`${path}: DIB ${width}px sai kích thước (biWidth=${biWidth}, biHeight=${biHeight}, biBitCount=${biBitCount}).`);
      }
    }
    sizes.push(width);
  }
  const missing = EXPECTED_ICO_SIZES.filter((size) => !sizes.includes(size));
  if (missing.length) throw new Error(`${path}: thiếu lớp cỡ ${missing.join(', ')} px.`);
}

async function validateSvg(path) {
  const text = await readFile(path, 'utf8');
  if (!text.includes('<svg') || !/viewBox=["']0 0 128 128["']/.test(text)) {
    throw new Error(`${path}: SVG thiếu phần tử gốc hoặc viewBox chuẩn.`);
  }
  // logo chuẩn 1.4: huy hiệu đỏ #DB2B23 + nút play trắng, đều là đường vẽ (path); không phụ thuộc ảnh/phông ngoài
  if (!text.includes('<path') || !text.includes('</svg>') || !text.includes('#DB2B23')) {
    throw new Error(`${path}: SVG logo thiếu hình khối bắt buộc.`);
  }
  if (/<image|<text|href=|@import|url\(/.test(text)) {
    throw new Error(`${path}: SVG logo không được phụ thuộc ảnh, phông hay tài nguyên ngoài.`);
  }
}

const publicFolder = join(process.cwd(), 'src', 'renderer', 'public');
const publicPngs = (await readdir(publicFolder))
  .filter((name) => name.toLowerCase().endsWith('.png'))
  .map((name) => join(publicFolder, name));
const pngs = [...publicPngs, join(process.cwd(), 'resources', 'icon.png')];

for (const path of pngs) await validatePng(path);
await validateIco(join(process.cwd(), 'resources', 'icon.ico'));
await validateSvg(join(publicFolder, 'tubmedia-icon.svg'));
console.log(`Đã kiểm tra ${pngs.length} PNG, 1 ICO và 1 SVG: hợp lệ.`);
