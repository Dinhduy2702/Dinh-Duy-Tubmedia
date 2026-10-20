import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Đường dẫn trong zip, phân tách bằng "/". */
  name: string;
  data: Buffer | string;
  modified?: Date;
}

const MAX_ZIP32 = 0xffff_ffff;

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function assertSafeName(name: string): void {
  const parts = name.split('/');
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || parts.some((part) => !part || part === '..')) {
    throw new Error(`Tên mục zip không hợp lệ: ${name}`);
  }
}

/**
 * Ghi zip (deflate, tên UTF-8) vào bộ nhớ — đủ cho báo cáo lỗi (JSON + nhật ký, vài MB). Không hỗ trợ zip64: tổng > 4 GB
 * thì báo lỗi thay vì ra tệp hỏng.
 */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const names = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    assertSafeName(entry.name);
    if (names.has(entry.name)) throw new Error(`Trùng tên mục zip: ${entry.name}`);
    names.add(entry.name);

    const name = Buffer.from(entry.name, 'utf8');
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw) >>> 0;
    const stamp = dosDateTime(entry.modified ?? new Date());
    if (raw.length > MAX_ZIP32 || offset + compressed.length > MAX_ZIP32) throw new Error('Báo cáo quá lớn cho định dạng zip.');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // phiên bản tối thiểu
    local.writeUInt16LE(0x0800, 6); // bit 11: tên UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // tạo bởi (MS-DOS / phiên bản 2.0)
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // thuộc tính trong
    central.writeUInt32LE(0, 38); // thuộc tính ngoài
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  if (entries.length > 0xffff) throw new Error('Báo cáo có quá nhiều mục cho định dạng zip.');
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}
