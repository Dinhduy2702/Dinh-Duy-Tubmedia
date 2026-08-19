import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

const cwd = process.cwd();
const project = path.resolve(process.argv[2] ?? cwd);
const output = path.resolve(
  process.argv[3] ?? path.join(project, 'release', 'public-v1.3.1-feed-repair', 'latest.yml')
);

const url = 'https://github.com/Dinhduy2702/Dinh-Duy-Tubmedia/releases/download/v1.3.1/latest.yml';

function startsWith(bytes, prefix) {
  if (bytes.length < prefix.length) {
    return false;
  }

  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) {
      return false;
    }
  }

  return true;
}

function stripKnownLeadingArtifacts(input) {
  let bytes = input;
  let changed = false;

  const utf8Bom = Uint8Array.from([0xef, 0xbb, 0xbf]);
  const mojibakeUtf8 = Uint8Array.from([0xc3, 0xaf, 0xc2, 0xbb, 0xc2, 0xbf]);

  for (;;) {
    if (startsWith(bytes, utf8Bom)) {
      bytes = bytes.subarray(utf8Bom.length);
      changed = true;
      continue;
    }

    if (startsWith(bytes, mojibakeUtf8)) {
      bytes = bytes.subarray(mojibakeUtf8.length);
      changed = true;
      continue;
    }

    break;
  }

  return { bytes, changed };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function firstBytesHex(bytes, count = 12) {
  return [...bytes.subarray(0, Math.min(count, bytes.length))]
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

const response = await globalThis.fetch(url, {
  redirect: 'follow',
  headers: {
    'user-agent': 'Tubmedia-PRE132-R12',
    accept: 'application/octet-stream'
  }
});

if (!response.ok) {
  throw new Error(`Cannot download public v1.3.1 latest.yml: HTTP ${response.status}`);
}

const original = new Uint8Array(await response.arrayBuffer());
const repaired = stripKnownLeadingArtifacts(original);

console.log(`publicOriginalFirstBytes=${firstBytesHex(original)}`);
console.log(`publicOriginalSha256=${sha256(original)}`);
console.log(`leadingArtifactRemoved=${repaired.changed}`);

const text = new TextDecoder('utf-8', { fatal: true }).decode(repaired.bytes);

if (!text.startsWith('version: 1.3.1\n')) {
  throw new Error(
    `Public feed does not normalize to canonical version prefix: ${firstBytesHex(repaired.bytes)}`
  );
}

const updaterPackagePath = path.join(project, 'node_modules', 'electron-updater', 'package.json');

const updaterRequire = createRequire(updaterPackagePath);
const yaml = updaterRequire('js-yaml');
const info = yaml.load(text);

if (
  info?.version !== '1.3.1' ||
  info?.files?.[0]?.url !== 'Download-video-Tubmedia-Setup-1.3.1-x64.exe' ||
  typeof info?.files?.[0]?.sha512 !== 'string' ||
  info.files[0].sha512.length < 80 ||
  !Number.isFinite(Number(info?.files?.[0]?.size)) ||
  Number(info.files[0].size) < 100_000_000
) {
  throw new Error('Public v1.3.1 metadata is incomplete or unexpected');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, text, { encoding: 'utf8' });

const written = fs.readFileSync(output);
const expectedPrefix = Buffer.from('version:', 'ascii');

if (
  startsWith(written, Uint8Array.from([0xef, 0xbb, 0xbf])) ||
  !written.subarray(0, expectedPrefix.length).equals(expectedPrefix)
) {
  throw new Error('Prepared public repair was not written canonically');
}

const roundTrip = yaml.load(new TextDecoder('utf-8', { fatal: true }).decode(written));

if (roundTrip?.version !== '1.3.1') {
  throw new Error('Prepared public repair failed YAML round-trip');
}

console.log('PUBLIC_V131_FEED_REPAIR_PREPARED_OK');
console.log(`output=${output}`);
console.log(`repairFirstBytes=${firstBytesHex(written)}`);
console.log(`repairSha256=${sha256(written)}`);
console.log(`url=${roundTrip.files[0].url}`);
console.log(`size=${roundTrip.files[0].size}`);
console.log(`sha512=${roundTrip.files[0].sha512}`);
