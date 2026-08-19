'use strict';

/* global require, process, module */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

const WINDOWS_FORBIDDEN_PATH_CHARS = '<>:"|?*';
const MAX_ENTRIES = 100000;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        lazyEntries: true,
        decodeStrings: true,
        strictFileNames: true,
        validateEntrySizes: true
      },
      (error, zipFile) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(zipFile);
      }
    );
  });
}

function openEntryStream(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stream);
    });
  });
}

function hasUnsafeWindowsPathCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      (typeof codePoint === 'number' && codePoint <= 0x1f) ||
      WINDOWS_FORBIDDEN_PATH_CHARS.includes(character)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeEntryName(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0) {
    throw new Error('ZIP entry has an empty name.');
  }

  if (rawName.includes('\0')) {
    throw new Error('ZIP entry contains a NUL byte.');
  }

  const name = rawName.replace(/\\/g, '/');

  if (name.startsWith('/') || name.startsWith('//') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`ZIP entry uses an absolute path: ${rawName}`);
  }

  const parts = name.split('/').filter((part) => part.length > 0);

  for (const part of parts) {
    if (part === '..') {
      throw new Error(`ZIP entry attempts directory traversal: ${rawName}`);
    }

    if (hasUnsafeWindowsPathCharacter(part)) {
      throw new Error(`ZIP entry contains an unsafe Windows path segment: ${rawName}`);
    }

    if (/[. ]$/.test(part)) {
      throw new Error(`ZIP entry has a trailing dot/space segment: ${rawName}`);
    }

    const deviceBase = part.split('.')[0].toUpperCase();

    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceBase)) {
      throw new Error(`ZIP entry uses a reserved Windows device name: ${rawName}`);
    }
  }

  const normalized = parts.filter((part) => part !== '.').join('/');

  if (!normalized) {
    throw new Error(`ZIP entry resolves to an empty path: ${rawName}`);
  }

  return normalized;
}

function unixFileType(entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return mode & 0o170000;
}

function isSymlinkEntry(entry) {
  return unixFileType(entry) === 0o120000;
}

function isDirectoryEntry(entry) {
  return /\/$/.test(entry.fileName) || unixFileType(entry) === 0o040000;
}

function assertInsideRoot(root, candidate, rawName) {
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;

  if (candidate !== root && !candidate.startsWith(rootPrefix)) {
    throw new Error(`ZIP entry escapes extraction root: ${rawName}`);
  }
}

async function ensureSafeDirectory(root, directory) {
  const relative = path.relative(root, directory);

  if (!relative || relative === '.') {
    await fsp.mkdir(root, { recursive: true });
    return;
  }

  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Directory escapes extraction root: ${directory}`);
  }

  await fsp.mkdir(root, { recursive: true });

  let current = root;

  for (const part of relative.split(path.sep)) {
    if (!part) {
      continue;
    }

    current = path.join(current, part);

    try {
      const stat = await fsp.lstat(current);

      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing symbolic-link extraction parent: ${current}`);
      }

      if (!stat.isDirectory()) {
        throw new Error(`Extraction parent is not a directory: ${current}`);
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        await fsp.mkdir(current);
        continue;
      }

      throw error;
    }
  }
}

async function assertWritableTargetIsNotLink(target) {
  try {
    const stat = await fsp.lstat(target);

    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite a symbolic link: ${target}`);
    }

    if (stat.isDirectory()) {
      throw new Error(`Refusing to overwrite a directory with a file: ${target}`);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function safeExtract(zipPath, options) {
  if (!options || typeof options.dir !== 'string' || options.dir.length === 0) {
    throw new TypeError('safe-extract-zip requires options.dir');
  }

  const root = path.resolve(options.dir);

  await fsp.mkdir(root, { recursive: true });

  const rootStat = await fsp.lstat(root);

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Extraction root must be a real directory, not a link: ${root}`);
  }

  await ensureSafeDirectory(root, root);

  const zipFile = await openZip(zipPath);

  return await new Promise((resolve, reject) => {
    let settled = false;
    let entryCount = 0;
    let totalUncompressedBytes = 0;

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        zipFile.close();
      } catch (closeError) {
        void closeError;
      }

      reject(error);
    };

    zipFile.once('error', fail);

    zipFile.once('end', () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    });

    zipFile.on('entry', (entry) => {
      void (async () => {
        entryCount += 1;

        const uncompressedSize = Number(entry.uncompressedSize || 0);
        totalUncompressedBytes += uncompressedSize;

        if (entryCount > MAX_ENTRIES) {
          throw new Error(`ZIP contains too many entries: ${entryCount}`);
        }

        if (uncompressedSize > MAX_ENTRY_BYTES) {
          throw new Error(`ZIP entry is too large: ${entry.fileName}`);
        }

        if (totalUncompressedBytes > MAX_TOTAL_BYTES) {
          throw new Error('ZIP expands beyond Tubmedia safety limit.');
        }

        if (isSymlinkEntry(entry)) {
          throw new Error(`Refusing symbolic-link ZIP entry: ${entry.fileName}`);
        }

        const normalized = normalizeEntryName(entry.fileName);
        const destination = path.resolve(root, ...normalized.split('/'));

        assertInsideRoot(root, destination, entry.fileName);

        if (typeof options.onEntry === 'function') {
          await options.onEntry(entry, zipFile);
        }

        if (isDirectoryEntry(entry)) {
          await ensureSafeDirectory(root, destination);
          zipFile.readEntry();
          return;
        }

        await ensureSafeDirectory(root, path.dirname(destination));
        await assertWritableTargetIsNotLink(destination);

        const input = await openEntryStream(zipFile, entry);
        const temp = `${destination}.tubmedia-extract-${process.pid}-${Date.now()}`;

        try {
          const output = fs.createWriteStream(temp, { flags: 'wx' });
          await pipeline(input, output);

          await assertWritableTargetIsNotLink(destination);
          await fsp.rm(destination, { force: true });
          await fsp.rename(temp, destination);
        } catch (error) {
          await fsp.rm(temp, { force: true }).catch(() => undefined);
          throw error;
        }

        zipFile.readEntry();
      })().catch(fail);
    });

    zipFile.readEntry();
  });
}

module.exports = safeExtract;
module.exports.default = safeExtract;
