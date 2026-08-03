import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const explicitRoot = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : null;
const strictClean = process.argv.includes('--strict-clean');
const root = resolve(explicitRoot || process.cwd());
const posix = (value) => value.split(sep).join('/');
const fileExists = async (path) =>
  stat(path)
    .then((info) => info.isFile())
    .catch(() => false);
const directoryExists = async (path) =>
  stat(path)
    .then((info) => info.isDirectory())
    .catch(() => false);
const readText = (path) => readFile(path, 'utf8');
const errors = [];
const warnings = [];
const allowedToolSourceFiles = new Set(['tool/.vdmsp-tool-metadata.json', 'tool/README_TOOL_VI.txt']);

function isWorkspaceGeneratedPath(relativePath) {
  const normalized = relativePath.split('\\').join('/');
  const lower = normalized.toLowerCase();

  if (lower === 'installer/generated-config.nsh') return true;
  if (lower.endsWith('.tsbuildinfo')) return true;
  if (lower.startsWith('tool/')) {
    return !allowedToolSourceFiles.has(normalized);
  }
  return false;
}

function fail(message) {
  errors.push(message);
  console.error(`FAIL: ${message}`);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.warn(`WARN: ${message}`);
}

async function walk(folder, ignoredDirectoryNames = new Set()) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, ignoredDirectoryNames)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function findForbiddenDirectories(folder, forbiddenNames, found = []) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(folder, entry.name);
    if (forbiddenNames.has(entry.name)) {
      found.push(path);
      continue;
    }
    await findForbiddenDirectories(path, forbiddenNames, found);
  }
  return found;
}

const manifestPath = join(root, 'source-manifest.json');
if (!(await fileExists(manifestPath))) {
  fail('Thiếu source-manifest.json.');
  throw new Error('Source completeness failed before manifest load.');
}

const manifest = JSON.parse(await readText(manifestPath));
const forbiddenDirectoryNames = new Set(manifest.forbiddenDirectoryNames || []);
const packagePath = join(root, 'package.json');
const packageLockPath = join(root, 'package-lock.json');
const packageJson = JSON.parse(await readText(packagePath));
const packageLock = JSON.parse(await readText(packageLockPath));

if (strictClean) {
  const forbiddenDirectories = await findForbiddenDirectories(root, forbiddenDirectoryNames);
  for (const directory of forbiddenDirectories) {
    fail(`Source sạch chứa thư mục sinh tự động: ${posix(relative(root, directory))}/`);
  }
  if (!forbiddenDirectories.length) pass('source package không chứa thư mục sinh tự động');
}

if (packageJson.version !== manifest.appVersion) {
  fail(`package.json=${packageJson.version} nhưng source-manifest=${manifest.appVersion}.`);
} else {
  pass(`phiên bản source đồng bộ ${packageJson.version}`);
}

if (
  packageLock.version !== packageJson.version ||
  packageLock.packages?.['']?.version !== packageJson.version
) {
  fail('package-lock.json không đồng bộ phiên bản package.json.');
} else {
  pass('package-lock.json đồng bộ phiên bản');
}

for (const directory of manifest.requiredDirectories) {
  if (!(await directoryExists(join(root, directory)))) fail(`Thiếu thư mục bắt buộc: ${directory}`);
}
for (const file of manifest.requiredFiles) {
  if (!(await fileExists(join(root, file)))) fail(`Thiếu file bắt buộc: ${file}`);
}
if (!errors.length) pass('đủ thư mục và file bắt buộc trong source manifest');

const discoveredFiles = await walk(root, forbiddenDirectoryNames);
const allFiles = strictClean
  ? discoveredFiles
  : discoveredFiles.filter((path) => !isWorkspaceGeneratedPath(posix(relative(root, path))));
const allRelative = allFiles.map((path) => posix(relative(root, path)));

if (strictClean) {
  for (const path of discoveredFiles) {
    const relativePath = posix(relative(root, path));
    if (isWorkspaceGeneratedPath(relativePath)) {
      fail(`Source sạch chứa file sinh tự động: ${relativePath}`);
    }
  }
}

const inventoryPath = join(root, 'SOURCE_INVENTORY.sha256');
const inventoryListPath = join(root, 'PROJECT_FILE_LIST.txt');
if (await fileExists(inventoryPath)) {
  const inventoryLines = (await readText(inventoryPath))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const inventory = new Map();
  for (const line of inventoryLines) {
    const match = /^([A-F0-9]{64})\s{2}(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) {
      fail(`SOURCE_INVENTORY.sha256 có dòng không hợp lệ: ${line}`);
      continue;
    }
    inventory.set(match[2], match[1]);
  }

  const expectedInventoryFiles = allFiles
    .filter((path) => ![inventoryPath, inventoryListPath].includes(path))
    .map((path) => posix(relative(root, path)))
    .sort();
  for (const relativePath of expectedInventoryFiles) {
    const expectedHash = inventory.get(relativePath);
    if (!expectedHash) {
      fail(`Source inventory thiếu file: ${relativePath}`);
      continue;
    }
    const actualHash = createHash('sha256')
      .update(await readFile(join(root, relativePath)))
      .digest('hex')
      .toUpperCase();
    if (actualHash !== expectedHash) {
      fail(`Source inventory sai SHA-256: ${relativePath}`);
    }
  }
  for (const relativePath of inventory.keys()) {
    if (!expectedInventoryFiles.includes(relativePath)) {
      fail(`Source inventory tham chiếu file không tồn tại/không được quản lý: ${relativePath}`);
    }
  }
  if (!errors.some((item) => item.includes('Source inventory'))) {
    pass(`source inventory khớp ${expectedInventoryFiles.length} file`);
  }
}

const validationRelativePaths = strictClean
  ? discoveredFiles.map((path) => posix(relative(root, path)))
  : allRelative;
for (const path of validationRelativePaths) {
  const extension = extname(path).toLowerCase();
  if (manifest.forbiddenFileExtensions.includes(extension)) {
    const allowedAsset = path === 'resources/icon.ico';
    if (!allowedAsset) fail(`Source sạch chứa file nhị phân/media bị cấm: ${path}`);
  }

  if (/^(?:.*\/)?(?:cookies?|credentials?|secrets?)\.(?:txt|json)$/i.test(path)) {
    fail(`Source sạch chứa file nhạy cảm: ${path}`);
  }
  if (/(?:^|\/)\.env(?:\.|$)/i.test(path) || /\.(?:pem|key|pfx|p12)$/i.test(path)) {
    fail(`Source sạch chứa secret/certificate: ${path}`);
  }
}

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const sourceFiles = allFiles.filter((path) => sourceExtensions.has(extname(path)));
const importPattern =
  /(?:import\s+(?:type\s+)?[\s\S]*?\s+from\s+|export\s+(?:type\s+)?[\s\S]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
const aliases = {
  '@shared/': join(root, 'src/shared'),
  '@main/': join(root, 'src/main'),
  '@renderer/': join(root, 'src/renderer')
};
const knownBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const declaredPackages = new Set([
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.devDependencies || {})
]);

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

async function resolveModule(basePath) {
  const candidates = [basePath];
  const extension = extname(basePath);
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    const stem = basePath.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, basePath);
  } else if (!extension) {
    candidates.push(
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.mjs`,
      `${basePath}.cjs`,
      join(basePath, 'index.ts'),
      join(basePath, 'index.tsx'),
      join(basePath, 'index.js'),
      join(basePath, 'index.mjs')
    );
  }
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

let importCount = 0;
for (const sourcePath of sourceFiles) {
  const source = await readText(sourcePath);
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier) continue;
    importCount += 1;

    let target = null;
    if (specifier.startsWith('.')) {
      target = resolve(dirname(sourcePath), specifier);
    } else {
      const alias = Object.entries(aliases).find(([prefix]) => specifier.startsWith(prefix));
      if (alias) target = join(alias[1], specifier.slice(alias[0].length));
    }

    if (target) {
      if (!(await resolveModule(normalize(target)))) {
        fail(`${posix(relative(root, sourcePath))}: import không tồn tại: ${specifier}`);
      }
      continue;
    }

    if (knownBuiltins.has(specifier) || specifier.startsWith('node:')) continue;
    const dependency = packageName(specifier);
    if (!declaredPackages.has(dependency)) {
      fail(`${posix(relative(root, sourcePath))}: dependency chưa khai báo: ${specifier}`);
    }
  }
}
if (
  !errors.some((item) => item.includes('import không tồn tại') || item.includes('dependency chưa khai báo'))
) {
  pass(`đã xác minh ${importCount} import và dependency`);
}

const build = packageJson.build || {};
for (const resource of build.extraResources || []) {
  if (
    typeof resource?.from === 'string' &&
    !(await fileExists(join(root, resource.from))) &&
    !(await directoryExists(join(root, resource.from)))
  ) {
    fail(`build.extraResources tham chiếu đường dẫn thiếu: ${resource.from}`);
  }
}
if (typeof build.nsis?.include === 'string' && !(await fileExists(join(root, build.nsis.include)))) {
  fail(`build.nsis.include bị thiếu: ${build.nsis.include}`);
}

const identity = JSON.parse(await readText(join(root, 'installer/identity.json')));
if (identity.appId !== build.appId || identity.productName !== build.productName) {
  fail('installer/identity.json không đồng bộ appId/productName với package.json.');
} else {
  pass('installer identity đồng bộ với package.json');
}

const appConstants = await readText(join(root, 'src/shared/constants/app.ts'));
if (!appConstants.includes(`v${packageJson.version}`)) {
  fail('APP_VERSION_LABEL không đồng bộ package.json.');
}

const officialBuild = await readText(join(root, 'BUILD_INSTALLER_CHINH_THUC.ps1'));
if (!officialBuild.includes(packageJson.version)) {
  fail('BUILD_INSTALLER_CHINH_THUC.ps1 không chứa phiên bản hiện tại.');
}

const quickService = await readText(join(root, 'src/main/download/quick-download-service.ts'));
const appContext = await readText(join(root, 'src/main/app/app-context.ts'));
const registerIpc = await readText(join(root, 'src/main/ipc/register-ipc.ts'));
if (!appContext.includes('new QuickDownloadService(') || !registerIpc.includes('ctx.quickDownload')) {
  fail('QuickDownloadService chưa được nối vào AppContext/IPC trung tâm.');
} else {
  pass('QuickDownloadService được quản lý qua AppContext');
}
if (!quickService.includes('this.processes.run({') || quickService.includes('spawn(')) {
  fail('QuickDownloadService phải dùng ProcessManager, không spawn process riêng.');
} else {
  pass('QuickDownloadService dùng ProcessManager trung tâm');
}

const mojibakeFragments = [
  'Ã¡',
  'Ã ',
  'Ã¢',
  'Ã£',
  'Ã¨',
  'Ãé',
  'Ãê',
  'Ãì',
  'Ãí',
  'Ãò',
  'Ãó',
  'Ãô',
  'Ãõ',
  'Ãù',
  'Ãú',
  'Ãý',
  'Ä‘',
  'Æ°',
  'Æ¡',
  'á»',
  'áº',
  'â€”',
  'â€“',
  'â€œ',
  'â€'
];
const runtimeTextRoots = [join(root, 'src'), join(root, 'installer'), join(root, 'resources')];
const runtimeTextFiles = [join(root, 'package.json'), join(root, 'BUILD_INSTALLER_CHINH_THUC.ps1')];
const mojibakeCandidates = [
  ...runtimeTextFiles,
  ...(await Promise.all(runtimeTextRoots.map((folder) => walk(folder, forbiddenDirectoryNames)))).flat()
].filter((path) => {
  if (strictClean) return true;
  return !isWorkspaceGeneratedPath(posix(relative(root, path)));
});
for (const path of mojibakeCandidates) {
  const extension = extname(path).toLowerCase();
  if (
    !['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.txt', '.ps1', '.nsi', '.nsh', '.yml', '.yaml'].includes(
      extension
    )
  )
    continue;
  const text = await readText(path).catch(() => '');
  const fragment = mojibakeFragments.find((candidate) => text.includes(candidate));
  if (fragment) {
    fail(`Phát hiện chuỗi có thể lỗi bảng mã (${fragment}): ${posix(relative(root, path))}`);
  }
}

const hash = createHash('sha256');
for (const file of allFiles.sort()) {
  const relativePath = posix(relative(root, file));
  if (relativePath === 'SOURCE_INVENTORY.sha256') continue;
  hash.update(relativePath);
  hash.update('\0');
  hash.update(await readFile(file));
  hash.update('\0');
}
const inventoryHash = hash.digest('hex').toUpperCase();
console.log(`INFO: source inventory SHA-256 ${inventoryHash}`);

if (warnings.length) warn(`${warnings.length} cảnh báo không chặn.`);
if (errors.length) {
  throw new Error(`Source completeness failed: ${errors.length} lỗi.`);
}
console.log(
  `Source completeness verification OK: ${allFiles.length} managed files (${strictClean ? 'strict clean package' : 'installed workspace'}).`
);
