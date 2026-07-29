import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const checks = [];
const expectText = async (path, text, label) => {
  const source = await read(path);
  if (!source.includes(text)) throw new Error(`${label}: thiếu ${text} trong ${path}`);
  checks.push(label);
};

await expectText('installer/identity.json', 'com.tubmedia.download-video', 'Định danh installer cố định');
await expectText('installer/identity.json', 'Software\\\\Tubmedia\\\\DownloadVideo', 'Khóa Registry không có version');
await expectText('installer/video-studio-pro.nsi', 'InstallDirRegKey HKCU "${INSTALL_REGISTRY_KEY}"', 'Installer tìm thư mục cũ');
await expectText('installer/video-studio-pro.nsi', 'Function SkipDirectoryPageForUpgrade', 'Upgrade bỏ trang chọn thư mục');
await expectText('installer/video-studio-pro.nsi', 'Section "Uninstall"', 'Section uninstall ASCII ổn định');
await expectText('src/main/normalize/normalize-engine.ts', 'target.videoBitrate ?? sourceEquivalentVideoBitrate(source)', 'Dùng bitrate trung bình toàn bộ nguồn');

console.log(`Tubmedia v0.10.1 verification OK: ${checks.length} checks.`);
