import fs from 'node:fs';
import path from 'node:path';

const mainRoot = path.join(process.cwd(), 'src', 'main');
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
}

walk(mainRoot);

const hits = [];
const unsafe = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');

  if (!text.includes('--socket-timeout')) continue;

  hits.push(path.relative(process.cwd(), file).replaceAll('\\', '/'));

  const patterns = [/["']--socket-timeout["']\s*,\s*["'](\d+)["']/g, /--socket-timeout(?:=|\s+)(\d+)/g];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);

      if (Number.isFinite(value) && value > 30) {
        unsafe.push({
          file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
          value
        });
      }
    }
  }
}

let checks = 0;
let failures = 0;

function check(ok, label) {
  checks += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

check(hits.length > 0, 'at least one real yt-dlp socket-timeout location exists under src/main');

check(unsafe.length === 0, 'no explicit yt-dlp socket timeout exceeds thirty seconds');

console.log(`INFO: socket-timeout files=${hits.length}`);

for (const file of hits) {
  console.log(`INFO: ${file}`);
}

for (const item of unsafe) {
  console.log(`UNSAFE: ${item.file} timeout=${item.value}`);
}

if (failures) {
  throw new Error(`Download stall recovery verification failed: ${failures}/${checks}`);
}

console.log(`Tubmedia download stall recovery verification OK: ${checks} checks.`);
