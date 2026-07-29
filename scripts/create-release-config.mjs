import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const rawUrl = (process.env.TUBMEDIA_UPDATE_URL ?? '').trim();
const channelInput = (process.env.TUBMEDIA_UPDATE_CHANNEL ?? 'stable').trim().toLowerCase();

if (!rawUrl) {
  throw new Error('Thiếu biến TUBMEDIA_UPDATE_URL. Ví dụ: https://updates.example.com/tubmedia/');
}
const parsed = new URL(rawUrl);
if (parsed.protocol !== 'https:') {
  throw new Error('TUBMEDIA_UPDATE_URL bắt buộc dùng HTTPS.');
}
if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';

const channel = channelInput === 'beta' ? 'beta' : 'latest';
const publish = [{ provider: 'generic', url: parsed.toString(), channel }];
const config = {
  ...packageJson.build,
  publish,
  generateUpdatesFilesForAllChannels: channel === 'beta',
  nsis: {
    ...packageJson.build.nsis,
    differentialPackage: true,
    guid: packageJson.build.appId
  }
};

const outDir = resolve(root, '.release');
const outPath = resolve(outDir, 'electron-builder.release.json');
await mkdir(outDir, { recursive: true });
await writeFile(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(outPath);
