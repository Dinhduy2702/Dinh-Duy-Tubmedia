import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

const cwd = process.cwd();

function parseArgs(argv) {
  const out = {};

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];

    if (value === '--project') {
      out.project = argv[++i];
    } else if (value === '--release-dir') {
      out.releaseDir = argv[++i];
    } else if (value === '--version') {
      out.version = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return out;
}

function hasUtf8Bom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function firstBytesHex(bytes, count = 12) {
  return [...bytes.subarray(0, Math.min(count, bytes.length))]
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

const args = parseArgs(process.argv.slice(2));
const project = path.resolve(args.project ?? cwd);
const releaseDir = path.resolve(args.releaseDir ?? path.join(project, 'release'));

const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));

const version = args.version ?? pkg.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('Cannot determine Tubmedia version');
}

const installerName = `Download-video-Tubmedia-Setup-${version}-x64.exe`;

const installerPath = path.join(releaseDir, installerName);

if (!fs.existsSync(installerPath)) {
  throw new Error(`Installer not found for updater metadata: ${installerPath}`);
}

const installer = fs.readFileSync(installerPath);
const sha512 = crypto.createHash('sha512').update(installer).digest('base64');

const size = installer.length;
const releaseDate = new Date().toISOString();

const lines = [
  `version: ${version}`,
  'files:',
  `  - url: "${installerName}"`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: "${installerName}"`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ''
];

const text = lines.join('\n');
const latestPath = path.join(releaseDir, 'latest.yml');

fs.writeFileSync(latestPath, text, { encoding: 'utf8' });

const bytes = fs.readFileSync(latestPath);

if (hasUtf8Bom(bytes)) {
  throw new Error('latest.yml unexpectedly contains UTF-8 BOM bytes');
}

const expectedPrefix = Buffer.from('version:', 'ascii');

if (!bytes.subarray(0, expectedPrefix.length).equals(expectedPrefix)) {
  throw new Error(`latest.yml has an unexpected byte prefix: ${firstBytesHex(bytes)}`);
}

const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

if (!decoded.startsWith(`version: ${version}\n`)) {
  throw new Error('latest.yml does not begin with canonical version metadata');
}

const updaterPackagePath = path.join(project, 'node_modules', 'electron-updater', 'package.json');

const updaterRequire = createRequire(updaterPackagePath);
const yaml = updaterRequire('js-yaml');
const parsed = yaml.load(decoded);

if (
  parsed?.version !== version ||
  parsed?.files?.[0]?.url !== installerName ||
  parsed?.files?.[0]?.sha512 !== sha512 ||
  Number(parsed?.files?.[0]?.size) !== size ||
  parsed?.path !== installerName ||
  parsed?.sha512 !== sha512
) {
  throw new Error('latest.yml round-trip YAML metadata validation failed');
}

console.log('UPDATER_METADATA_NODE_UTF8NOBOM_OK');
console.log(`path=${latestPath}`);
console.log(`version=${version}`);
console.log(`size=${size}`);
console.log(`sha512=${sha512}`);
console.log(`firstBytes=${firstBytesHex(bytes)}`);
