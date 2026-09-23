import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const require = createRequire(import.meta.url);
const ts = require('typescript');

const required = [
  'src/shared/system-cleanup.ts',
  'src/main/system/system-cleanup-service.ts',
  'src/main/system/cleanup-scanner.ts',
  'src/renderer/src/components/SystemCleanupPanel.tsx',
  'tests/unit/system-cleanup-policy.test.ts'
];

for (const relative of required) {
  if (!existsSync(join(root, relative))) {
    throw new Error(`Thiếu file tích hợp dọn dẹp: ${relative}`);
  }
}

function read(relative) {
  return readFileSync(join(root, relative), 'utf8');
}

function unwrapExpression(node) {
  let current = node;

  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression?.(current))
  ) {
    current = current.expression;
  }

  return current;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }

  return null;
}

function literalValue(node) {
  const current = unwrapExpression(node);

  if (current.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (current.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text;
  }

  return undefined;
}

function readArrayLiteral(source, fileName, variableName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let declaration = null;

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      declaration = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!declaration?.initializer) {
    throw new Error(`Không tìm thấy ${variableName} bằng TypeScript AST.`);
  }

  const initializer = unwrapExpression(declaration.initializer);

  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(`${variableName} không phải mảng.`);
  }

  return initializer.elements.map((element) => {
    const current = unwrapExpression(element);

    if (!ts.isObjectLiteralExpression(current)) {
      throw new Error(`${variableName} chứa phần tử không phải object.`);
    }

    const record = {};

    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) {
        continue;
      }

      const name = propertyName(property.name);

      if (name) {
        record[name] = literalValue(property.initializer);
      }
    }

    return record;
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const channels = read('src/shared/contracts/channels.ts');
const schemas = read('src/shared/schemas/ipc.ts');
const registerIpc = read('src/main/ipc/register-ipc.ts');
const preload = read('src/preload/index.ts');
const apiTypes = read('src/preload/api-types.ts');
const cleanupPage = read('src/renderer/src/pages/SystemCleanupPage.tsx');
const cleanupPanel = read('src/renderer/src/components/SystemCleanupPanel.tsx');
const scanner = read('src/main/system/cleanup-scanner.ts');
const service = read('src/main/system/system-cleanup-service.ts');
const cleanupSource = read('src/shared/system-cleanup.ts');
const packageJson = JSON.parse(read('package.json'));
const categories = readArrayLiteral(cleanupSource, 'system-cleanup.ts', 'SYSTEM_CLEANUP_CATEGORIES');
const adminInfoItems = readArrayLiteral(cleanupSource, 'system-cleanup.ts', 'SYSTEM_CLEANUP_ADMIN_INFO_ITEMS');

const REMOVED_CATEGORY_IDS = [
  'recycleBin',
  'windowsTemp',
  'windowsUpdate',
  'deliveryOptimization',
  'componentStore',
  'diskInventory',
  'disableHibernate'
];

const checks = [
  [
    'cleanup channels use the shared IPC contract, including the new storage-settings shortcut',
    /systemCleanup\s*:/.test(channels) &&
      /["']system-cleanup:start["']/.test(channels) &&
      /["']system-cleanup:open-storage-settings["']/.test(channels)
  ],
  [
    'cleanup request is validated by zod and no longer accepts a scope field',
    schemas.includes('systemCleanupRequestSchema') &&
      schemas.includes('systemCleanupRunSchema') &&
      !/scope\s*:\s*z\.enum/.test(schemas)
  ],
  [
    'main registers cleanup handlers in registerIpc, including openStorageSettings via shell.openExternal',
    /new\s+SystemCleanupService\s*\(/.test(registerIpc) &&
      registerIpc.includes('IPC.systemCleanup.start') &&
      /ctx\.queue\.activeCount\s*\(\s*\)/.test(registerIpc) &&
      registerIpc.includes('IPC.systemCleanup.openStorageSettings') &&
      registerIpc.includes("shell.openExternal('ms-settings:storagesense')")
  ],
  [
    'preload exposes cleanup (including openStorageSettings) only inside window.desktop',
    /systemCleanup\s*:/.test(preload) &&
      /systemCleanup\s*:/.test(apiTypes) &&
      preload.includes('openStorageSettings') &&
      apiTypes.includes('openStorageSettings')
  ],
  ['cleanup page renders the cleanup panel', /<SystemCleanupPanel\s*\/>/.test(cleanupPage)],
  [
    'GĐ4a removed PowerShell/UAC entirely: no helper script, no extraResources entry, no elevation code left',
    (() => {
      const serviceCode = stripComments(service);
      const panelCode = stripComments(cleanupPanel);
      return (
        !existsSync(join(root, 'resources/system-cleanup-helper.ps1')) &&
        !JSON.stringify(packageJson.build?.extraResources ?? []).includes('system-cleanup-helper') &&
        !/Verb\s+RunAs/i.test(serviceCode) &&
        !serviceCode.includes('.ps1') &&
        !serviceCode.includes('powershell.exe') &&
        !/wholeMachine/.test(serviceCode) &&
        !/wholeMachine/.test(panelCode)
      );
    })()
  ],
  [
    'exactly 7 categories remain, all admin/UAC/irreversible/wholeMachine categories were removed',
    categories.length === 7 && REMOVED_CATEGORY_IDS.every((id) => !categories.some((item) => item.id === id))
  ],
  [
    'category fields no longer carry requiresAdmin/irreversible/group (dead once UAC and advanced group were removed)',
    categories.every(
      (item) => item.requiresAdmin === undefined && item.irreversible === undefined && item.group === undefined
    )
  ],
  [
    'admin-required maintenance is listed as report-only info, pointing at Windows Storage Sense instead',
    adminInfoItems.length === 4 &&
      REMOVED_CATEGORY_IDS.slice(1, 5).every((id) => adminInfoItems.some((item) => item.id === id)) &&
      cleanupPanel.includes('SYSTEM_CLEANUP_ADMIN_INFO_ITEMS') &&
      cleanupPanel.includes('Mở Dọn dẹp ổ đĩa Windows')
  ],
  [
    'crashReports scans only the current user CrashDumps folder, not the shared ProgramData WER queue',
    (() => {
      const scannerCode = stripComments(scanner);
      return !/ProgramData.*WER|WER.*ProgramData/i.test(scannerCode) && scannerCode.includes("case 'crashReports'");
    })()
  ],
  [
    'scanner blocks broad system roots and protects Zalo Received Files',
    scanner.includes('assertSafeCleanupPath') && scanner.includes('Đã chặn đường dẫn quá rộng/nguy hiểm')
  ],
  ['scanner protects Zalo Received Files', scanner.includes('Zalo Received Files')],
  [
    'Tubmedia residue scan requires internal identity (ownership marker + tracked DB files) and a 7-day cutoff',
    scanner.includes('hasTubmediaOwnershipMarker') &&
      scanner.includes('trackedTempFiles') &&
      scanner.includes('RESIDUE_CUTOFF_DAYS') &&
      scanner.includes('mtimeMs')
  ],
  [
    'GĐ4a rejects the delete mode with a clear message — only estimate/scan is implemented',
    service.includes("request.mode === 'clean'") && service.includes('Giai đoạn 4b') &&
      cleanupPanel.includes('disabled') &&
      cleanupPanel.includes('chưa mở ở bản này')
  ],
  [
    'scanner supports cooperative cancellation mid-scan (not just between categories)',
    scanner.includes('CleanupScanCancelledError') && scanner.includes('shouldCancel')
  ]
];

for (const [name, ok] of checks) {
  if (!ok) {
    throw new Error(`FAIL: ${name}`);
  }

  console.log(`PASS: ${name}`);
}

console.log(`System cleanup integration verification OK: ${checks.length} checks.`);
