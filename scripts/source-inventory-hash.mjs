import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

function isUtf8Text(content) {
  if (content.includes(0)) return false;
  const decoded = content.toString('utf8');
  return Buffer.from(decoded, 'utf8').equals(content);
}

export function canonicalizeSourceBytesForHash(content) {
  if (!isUtf8Text(content)) return content;
  const decoded = content.toString('utf8');
  if (!decoded.includes('\r\n')) return content;
  return Buffer.from(decoded.replace(/\r\n/g, '\n'), 'utf8');
}

export function isRootGitMetadataPath(relativePath) {
  const normalized = relativePath.split('\\').join('/');
  return normalized === '.git' || normalized.startsWith('.git/');
}

export function sourceSha256(content) {
  return createHash('sha256').update(canonicalizeSourceBytesForHash(content)).digest('hex').toUpperCase();
}
