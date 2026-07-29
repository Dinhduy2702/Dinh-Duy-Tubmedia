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

async function validateIco(path) {
  const data = await readFile(path);
  if (data.length < 22 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${path}: header ICO không hợp lệ.`);
  }
  const count = data.readUInt16LE(4);
  if (count < 1 || data.length < 6 + count * 16) throw new Error(`${path}: bảng ảnh ICO bị thiếu.`);
}

async function validateSvg(path) {
  const text = await readFile(path, 'utf8');
  if (!text.includes('<svg') || !/viewBox=["']0 0 128 128["']/.test(text)) {
    throw new Error(`${path}: SVG thiếu phần tử gốc hoặc viewBox chuẩn.`);
  }
  if (!text.includes('<rect') || !text.includes('<path') || !text.includes('</svg>')) {
    throw new Error(`${path}: SVG logo thiếu hình khối bắt buộc.`);
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
