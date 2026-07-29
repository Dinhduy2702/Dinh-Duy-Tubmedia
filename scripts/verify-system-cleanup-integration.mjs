import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const require = createRequire(import.meta.url);
const ts = require('typescript');

const required = [
  'src/shared/system-cleanup.ts',
  'src/main/system/system-cleanup-service.ts',
  'src/renderer/src/components/SystemCleanupPanel.tsx',
  'resources/system-cleanup-helper.ps1',
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

function readCleanupCategories(source) {
  const sourceFile = ts.createSourceFile(
    'system-cleanup.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  let declaration = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'SYSTEM_CLEANUP_CATEGORIES'
    ) {
      declaration = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!declaration?.initializer) {
    throw new Error('Không tìm thấy SYSTEM_CLEANUP_CATEGORIES bằng TypeScript AST.');
  }

  const initializer = unwrapExpression(declaration.initializer);

  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error('SYSTEM_CLEANUP_CATEGORIES không phải mảng.');
  }

  return initializer.elements.map((element) => {
    const current = unwrapExpression(element);

    if (!ts.isObjectLiteralExpression(current)) {
      throw new Error('Danh mục dọn dẹp chứa phần tử không phải object.');
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

const channels = read('src/shared/contracts/channels.ts');
const schemas = read('src/shared/schemas/ipc.ts');
const registerIpc = read('src/main/ipc/register-ipc.ts');
const preload = read('src/preload/index.ts');
const apiTypes = read('src/preload/api-types.ts');
const cachePage = read('src/renderer/src/pages/CachePage.tsx');
const helper = read('resources/system-cleanup-helper.ps1');
const cleanupSource = read('src/shared/system-cleanup.ts');
const packageJson = JSON.parse(read('package.json'));
const categories = readCleanupCategories(cleanupSource);

const irreversible = categories.filter((item) => item.irreversible === true);
const recycleBin = categories.find((item) => item.id === 'recycleBin');
const disableHibernate = categories.find((item) => item.id === 'disableHibernate');

const checks = [
  [
    'cleanup channels use the shared IPC contract',
    /systemCleanup\s*:/.test(channels) && /["']system-cleanup:start["']/.test(channels)
  ],
  [
    'cleanup request is validated by zod',
    schemas.includes('systemCleanupRequestSchema') && schemas.includes('systemCleanupRunSchema')
  ],
  [
    'main registers cleanup handlers in registerIpc',
    /new\s+SystemCleanupService\s*\(/.test(registerIpc) &&
      registerIpc.includes('IPC.systemCleanup.start') &&
      /ctx\.queue\.activeCount\s*\(\s*\)/.test(registerIpc)
  ],
  [
    'preload exposes cleanup only inside window.desktop',
    /systemCleanup\s*:/.test(preload) && /systemCleanup\s*:/.test(apiTypes)
  ],
  ['cache page renders cleanup panel', /<SystemCleanupPanel\b/.test(cachePage)],
  [
    'helper blocks broad roots',
    helper.includes('Assert-SafeTarget') && helper.includes('Đã chặn đường dẫn quá rộng/nguy hiểm')
  ],
  ['helper protects Zalo Received Files', helper.includes('Zalo Received Files')],
  [
    'irreversible cleanup is disabled by default',
    irreversible.length >= 2 &&
      irreversible.every((item) => item.defaultSelected === false) &&
      recycleBin?.irreversible === true &&
      recycleBin?.defaultSelected === false &&
      disableHibernate?.irreversible === true &&
      disableHibernate?.defaultSelected === false
  ],
  [
    'PowerShell helper is outside app.asar',
    Array.isArray(packageJson.build?.extraResources) &&
      packageJson.build.extraResources.some(
        (item) =>
          item?.from === 'resources/system-cleanup-helper.ps1' && item?.to === 'system-cleanup-helper.ps1'
      )
  ]
];

for (const [name, ok] of checks) {
  if (!ok) {
    throw new Error(`FAIL: ${name}`);
  }

  console.log(`PASS: ${name}`);
}

console.log(`System cleanup integration verification OK: ${checks.length} checks.`);
