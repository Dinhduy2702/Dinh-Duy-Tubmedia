import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const checks = [];
const expectText = async (path, text, label) => {
  const source = await read(path);
  if (!source.includes(text)) throw new Error(`${label}: thiếu ${text} trong ${path}`);
  checks.push(label);
};
const rejectText = async (path, text, label) => {
  const source = await read(path);
  if (source.includes(text)) throw new Error(`${label}: vẫn còn ${text} trong ${path}`);
  checks.push(label);
};

await expectText('src/main/ipc/register-ipc.ts', 'dialog.showSaveDialog', 'Save As timeline');
await expectText('src/renderer/src/pages/DownloadMergePage.tsx', '<FileDown size={17}/>', 'Icon xuất TXT');
await expectText(
  'src/main/merge/merge-engine.ts',
  "join(workFolder, '_normalized')",
  'Normalized nằm trong temp'
);
await expectText(
  'src/main/merge/merge-engine.ts',
  'const final = join(outputFolder',
  'Thành phẩm nằm trực tiếp trong output'
);
await expectText(
  'src/main/merge/merge-engine.ts',
  'if (oldBackup) await rm(oldBackup',
  'Không để lại backup tạm'
);
await expectText(
  'src/main/files/temporary-cleanup.ts',
  "['_normalized', '_quarantine', '_yt_tmp']",
  'Dọn thư mục app-owned'
);
await expectText('src/shared/utils/url.ts', 'downloadLinkTag', 'Nhận diện theo link');
await expectText(
  'src/shared/utils/download-quality.ts',
  'REFERENCE_1080P_FORMAT_SELECTOR',
  'Preset tham chiếu 1080p'
);
await expectText('src/shared/utils/download-quality.ts', "'bv*[height<=1080]+ba'", 'Fallback đa nền tảng');
await expectText(
  'src/main/settings/defaults.ts',
  'maxGlobalDownloadWorkers: 2',
  'Hai video đồng thời mặc định'
);
await expectText('src/main/downloader/download-engine.ts', '[${linkTag}]', 'Tên file có LINK tag');
await expectText(
  'src/main/downloader/download-engine.ts',
  'GOOGLE_DRIVE_INTERNAL_DOWNLOADER',
  'Google Drive dùng yt-dlp native'
);
await rejectText(
  'src/main/merge/merge-engine.ts',
  "join(outputFolder, '_normalized')",
  'Không ghi normalized vào output'
);
await rejectText(
  'src/main/merge/merge-engine.ts',
  "join(outputFolder, '_quarantine')",
  'Không ghi quarantine vào output'
);

console.log(`Tubmedia v0.10.0 verification OK: ${checks.length} checks.`);
