/**
 * Tìm SHA-256 của một tệp trong nội dung tệp checksum dạng "<sha256>  <tên tệp>"
 * (định dạng của `sha256sum`, cũng có thể là "<sha256> *<tên tệp>" ở chế độ nhị phân).
 * Trả về hash chữ thường, hoặc null nếu không có dòng khớp đúng tên tệp.
 */
export function findSha256InSums(text: string, fileName: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})[ \t]+\*?(.+?)$/.exec(rawLine.trim());
    if (!match) continue;
    const hash = match[1];
    const name = match[2];
    if (hash && name === fileName) return hash.toLowerCase();
  }
  return null;
}
