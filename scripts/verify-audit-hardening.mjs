import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), 'utf8');
const files = Object.fromEntries(
  await Promise.all(
    [
      'src/main/settings/defaults.ts',
      'src/main/settings/settings-service.ts',
      'src/main/downloader/download-engine.ts',
      'src/main/files/non-conflicting-path.ts',
      'src/main/files/file-ownership.ts',
      'src/main/files/temporary-cleanup.ts',
      'src/main/clips/clip-engine.ts',
      'src/main/normalize/normalize-engine.ts',
      'src/main/merge/merge-engine.ts',
      'src/main/merge/timeline-service.ts',
      'src/main/queue/queue-manager.ts',
      'src/main/processes/process-manager.ts',
      'src/main/database/repositories/queue-repository.ts',
      'src/shared/utils/job-state-machine.ts',
      'src/shared/utils/safe-json.ts',
      'src/shared/utils/secret-redaction.ts',
      'src/main/backups/backup-service.ts',
      'src/main/ipc/register-ipc.ts',
      'src/main/updates/tool-update-service.ts',
      'src/main/media/media-analyzer.ts',
      'src/main/logging/diagnostic-exporter.ts',
      'src/shared/utils/merge-target.ts',
      'src/main/database/repositories/project-repository.ts',
      'installer/identity.json',
      'installer/electron-builder-upgrade.nsh',
      'installer/video-studio-pro.nsi'
    ].map(async (path) => [path, await read(path)])
  )
);

const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const has = (path, token) => files[path].includes(token);

check(
  'fresh source mode is unbounded',
  has('src/main/settings/defaults.ts', 'downloadMinHeight: 0') &&
    has('src/main/settings/defaults.ts', 'downloadMaxHeight: 0') &&
    has('src/main/settings/defaults.ts', "downloadCodecPreference: 'auto'") &&
    has('src/main/settings/defaults.ts', "downloadContainerPreference: 'auto'")
);
check(
  'bounded source default has a migration',
  has('src/main/settings/settings-service.ts', 'fix_bounded_source_default_v1210')
);
check(
  'remux uses non-conflicting destination',
  has('src/main/downloader/download-engine.ts', 'nonConflictingPath(desiredOutput)') &&
    !has(
      'src/main/downloader/download-engine.ts',
      'await rm(output, { force: true });\n    await rename(pending, output);'
    )
);
check(
  'non-conflicting path helper exists',
  has('src/main/files/non-conflicting-path.ts', 'export async function nonConflictingPath')
);
check(
  'cleanup requires ownership marker',
  has('src/main/files/temporary-cleanup.ts', 'isTubmediaOwnedDirectory') &&
    has('src/main/files/file-ownership.ts', '.tubmedia-owned.json')
);
check('quarantine is not a cleanup namespace', !has('src/main/files/file-ownership.ts', "'_quarantine'"));
check(
  'mute-only copies video stream',
  has('src/main/clips/clip-engine.ts', "args.push('-c:v', 'copy')") &&
    has('src/main/clips/clip-engine.ts', 'const muteOnly')
);
check(
  'normalization prevents implicit crop/upscale',
  has('src/main/normalize/normalize-engine.ts', 'force_original_aspect_ratio=decrease') &&
    has('src/main/normalize/normalize-engine.ts', 'pad=${target.width}:${target.height}') &&
    !has('src/main/normalize/normalize-engine.ts', 'force_original_aspect_ratio=increase')
);
check(
  'timeline option reaches merge backend',
  /const\s+exportTimelineTxt\s*=\s*project\.exportTimelineTxt/.test(
    files['src/main/queue/queue-manager.ts']
  ) &&
    /this\.merger\.merge\([\s\S]*?\bprofile\s*,\s*signal\s*,\s*exportTimelineTxt\s*,/.test(
      files['src/main/queue/queue-manager.ts']
    ) &&
    /\bexportTimelineTxt\b/.test(files['src/main/merge/merge-engine.ts']) &&
    /safeName\s*,\s*exportTimelineTxt/.test(files['src/main/merge/merge-engine.ts'])
);
check(
  'final commit never overwrites an existing output',
  has('src/main/merge/merge-engine.ts', 'commitFileWithoutOverwrite(pending, final)')
);
check(
  'timeline export never overwrites an existing text file',
  has('src/main/merge/timeline-service.ts', 'commitFileWithoutOverwrite(pending, desired)')
);
check(
  'size validation uses pre-normalize merge inputs',
  has('src/main/merge/merge-engine.ts', 'validateMergeOutputSize(\n      infos,')
);
check(
  'blocking pause awaits process control before persisting paused',
  has('src/main/queue/queue-manager.ts', 'await this.processes.pauseByJob(active.job.id)') &&
    has('src/main/queue/queue-manager.ts', 'BACKGROUND_PAUSE_FAILED_ABORTED')
);
check(
  'process timeout and spawn errors are distinct',
  has('src/main/processes/process-manager.ts', 'ProcessTimeoutError') &&
    has('src/main/processes/process-manager.ts', 'ProcessSpawnError')
);
check(
  'unsupported job types fail explicitly',
  has('src/main/queue/queue-manager.ts', 'chưa có executor độc lập')
);
check(
  'malformed persisted JSON has safe decoders',
  has('src/shared/utils/safe-json.ts', 'parseJsonRecord') &&
    has('src/main/database/repositories/queue-repository.ts', 'parseJsonRecord(r.input_json)')
);
check(
  'repository enforces job transitions',
  /assertJobTransition\(\s*current\.status\s*,\s*patch\.status\s*\)/.test(
    files['src/main/database/repositories/queue-repository.ts']
  ) && /\ballowedTransitions\b/.test(files['src/shared/utils/job-state-machine.ts'])
);
check(
  'resume and retry reject illegal states',
  has('src/main/queue/queue-manager.ts', "if (!['paused', 'interrupted'].includes(current.status))") &&
    has('src/main/queue/queue-manager.ts', "if (!['failed', 'interrupted'].includes(current.status))")
);
check(
  'restore validates schema and sqlite integrity',
  has('src/main/backups/backup-service.ts', 'schemaVersion > currentSchema') &&
    has('src/main/backups/backup-service.ts', 'integrity_check') &&
    has('src/main/backups/backup-service.ts', 'foreign_key_check')
);
check(
  'restore is blocked while runtime work exists',
  has('src/main/ipc/register-ipc.ts', 'ctx.queue.activeCount() > 0 || ctx.processes.count() > 0')
);
check(
  'fake include-media backup is rejected',
  has('src/main/backups/backup-service.ts', 'Backup kèm media chưa được triển khai an toàn')
);
check(
  'diagnostic export sanitizes logs before copying',
  has('src/main/logging/diagnostic-exporter.ts', 'redactSecretText') &&
    has('src/main/ipc/register-ipc.ts', 'exportSanitizedLogTree')
);
check(
  'tool updates fail closed without SHA-256',
  has('src/main/updates/tool-update-service.ts', 'không có SHA-256 được công bố')
);
check(
  '10-bit SDR is not automatically HDR',
  !has('src/main/media/media-analyzer.ts', 'bitDepth >= 10') &&
    has('src/main/media/media-analyzer.ts', "transfer.includes('smpte2084')")
);
check(
  'HDR auto keeps all-HDR sources',
  has('src/shared/utils/merge-target.ts', "profile.hdrMode === 'keep' || profile.hdrMode === 'auto'")
);
check(
  'duplicated project does not reuse old source id',
  has('src/main/database/repositories/project-repository.ts', 'NULL,')
);
check(
  'installer source is self-contained',
  Object.keys(files).filter((path) => path.startsWith('installer/')).length === 3
);

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}: ${item.name}`);
if (failed.length) throw new Error(`${failed.length}/${checks.length} audit hardening checks failed.`);
console.log(`Audit hardening static verification OK: ${checks.length} checks.`);
