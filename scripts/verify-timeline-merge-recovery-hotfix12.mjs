import { readFile } from 'node:fs/promises';

const files = new Map();
async function source(relative) {
  if (!files.has(relative)) files.set(relative, await readFile(relative, 'utf8'));
  return files.get(relative);
}

let checks = 0;
let failures = 0;
function check(label, condition) {
  checks += 1;
  if (condition) console.log('PASS: ' + label);
  else {
    failures += 1;
    console.error('FAIL: ' + label);
  }
}

const [domain, schema, workbench, queue, clip, engine, ownership, ui, css, test, pkgText] = await Promise.all(
  [
    source('src/shared/types/domain.ts'),
    source('src/shared/schemas/ipc.ts'),
    source('src/main/workbench/workbench-service.ts'),
    source('src/main/queue/queue-manager.ts'),
    source('src/main/clips/clip-engine.ts'),
    source('src/main/merge/merge-engine.ts'),
    source('src/main/files/file-ownership.ts'),
    source('src/renderer/src/pages/DownloadMergePage.tsx'),
    source('src/renderer/src/tubmedia-theme.css'),
    source('tests/unit/timeline-merge-recovery-hotfix12.test.ts'),
    source('package.json')
  ]
);
const pkg = JSON.parse(pkgText);
const timelineMethod = engine.slice(
  engine.indexOf('public async createTimelineOnly('),
  engine.indexOf('public async merge(')
);
const timelineQueueBranch = queue.slice(
  queue.indexOf('/* TUBMEDIA TIMELINE ONLY QUEUE HOTFIX12 */'),
  queue.indexOf('    const quality =', queue.indexOf('/* TUBMEDIA TIMELINE ONLY QUEUE HOTFIX12 */'))
);

check(
  'timeline-only flag is backward-compatible in the shared merge contract',
  domain.includes('TUBMEDIA TIMELINE ONLY CONTRACT HOTFIX12') && domain.includes('timelineOnly?: boolean')
);
check(
  'timeline-only input is validated by IPC schemas',
  schema.includes('TUBMEDIA TIMELINE ONLY IPC HOTFIX12') &&
    (schema.match(/timelineOnly: z\.boolean\(\)\.default\(false\)/g) ?? []).length >= 2
);
check(
  'workbench normalizes and passes the selected mode to queue creation',
  workbench.includes('TUBMEDIA TIMELINE ONLY WORKBENCH HOTFIX12') &&
    workbench.includes('timelineOnly: value.timelineOnly === true')
);
check(
  'queue stores timeline-only on the dependent job',
  queue.includes('TUBMEDIA TIMELINE ONLY QUEUE HOTFIX12') &&
    queue.includes('timelineOnly,') &&
    queue.includes("progressStage: timelineOnly ? 'Chờ video nguồn để tạo timeline'")
);
check(
  'timeline-only skips clip jobs',
  queue.includes('!timelineOnly &&') && queue.includes("item.audioMode === 'mute'")
);
check(
  'timeline-only uses original source files and range metadata',
  queue.includes('timelineOnly ? source?.sourceFile') &&
    queue.includes('sourceStartSeconds: item.timestampStartSeconds')
);
check(
  'queue branches before the normal merge call',
  queue.indexOf('if (timelineOnly)') < queue.indexOf('const quality =') &&
    queue.includes('createTimelineOnly(')
);
check(
  'timeline-only result never advertises an MP4 output',
  queue.includes('outputPath: null') && queue.includes('timelineTxt: null')
);
check(
  'timeline-only progress remains in the legal merge state',
  queue.includes('TUBMEDIA LEGAL TIMELINE QUEUE STATE HOTFIX12R8') &&
    timelineQueueBranch.includes("'merging'") &&
    !timelineQueueBranch.includes("'processing'")
);
check(
  'engine exposes a source-verified timeline path',
  engine.includes('TUBMEDIA TIMELINE ONLY ENGINE HOTFIX12') &&
    engine.includes('TUBMEDIA VERIFIED TIMELINE SOURCES HOTFIX12R8') &&
    timelineMethod.includes('this.analyzer.analyze')
);
check(
  'every timeline source is decoded end-to-end before calculation',
  timelineMethod.includes("this.verifier.verify(input.path, 'deep'") &&
    timelineMethod.includes('expectedStreams: { video: true, audio: info.audioCodec !== null }') &&
    timelineMethod.includes('if (!checked.ok)') &&
    timelineMethod.indexOf("this.verifier.verify(input.path, 'deep'") <
      timelineMethod.indexOf('buildTimelineOnlyArtifact(')
);
check(
  'source verification names the failing input and keeps structured diagnostics',
  timelineMethod.includes("'timeline-source-deep-verification'") &&
    timelineMethod.includes('sourceIndex: index + 1') &&
    timelineMethod.includes('sourcePath: input.path')
);
check(
  'timeline-only path never normalizes, concatenates, encodes or writes output automatically',
  !/this\.normaliz|concatCopy|encode|timeline\.write|commitFile/i.test(timelineMethod)
);
check(
  'source start/end ranges are clamped before timeline accumulation',
  engine.includes('sourceEnd - sourceStart') &&
    engine.includes('sourceStartSeconds') &&
    engine.includes('sourceEndSeconds')
);
check(
  'existing video merge path remains available',
  engine.includes('public async merge(') && queue.includes('this.merger.merge(')
);
check(
  'UI offers an explicit no-video mode',
  ui.includes('TUBMEDIA TIMELINE ONLY UI HOTFIX12') && ui.includes('Chỉ tạo timeline (không ghép video)')
);
check('UI restores mode from the live queue job', ui.includes('job.input.timelineOnly === true'));
check(
  'UI also remembers timeline-only choice before a queue job exists',
  ui.includes('loadTimelineOnlyMode(') && ui.includes('saveTimelineOnlyMode(')
);
check(
  'timeline is displayed and TXT export remains user initiated',
  ui.includes('merge-timeline-preview') && ui.includes('window.desktop.dialogs.saveTextFile')
);
check(
  'UI clearly states that no MP4 is created',
  ui.includes('Không tạo MP4') && css.includes('TUBMEDIA TIMELINE ONLY STYLE HOTFIX12')
);
check(
  'UI explains source verification before timeline calculation',
  ui.includes('kiểm tra toàn bộ video nguồn') && ui.includes('kiểm tra giải mã từng tệp từ đầu đến cuối')
);
check(
  'focused tests cover trimming, clamping and invalid ranges',
  test.includes('applies source start/end ranges') && test.includes('rejects an empty effective range')
);
check(
  'unchanged merge requests preserve item IDs and bind old candidates to a request signature',
  workbench.includes('TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12') &&
    workbench.includes('mergeRequestUnchanged(') &&
    workbench.includes('mergeRequestSignature(') &&
    workbench.includes('if (!unchanged) this.input.import')
);
check(
  'completed outputs and legacy pending paths are forwarded only by the main process',
  workbench.includes('trustedOutputPath') &&
    workbench.includes('legacyPendingPaths') &&
    queue.includes('options.trustedOutputPath') &&
    queue.includes('mergeRequestSignature: options.requestSignature')
);
check(
  'a cancelled job never guesses that an unreceipted final file is reusable',
  !workbench.includes('lateMergeExists') &&
    workbench.includes("['completed', 'skipped'].includes(job.status)")
);
check(
  'merge inputs carry a stable logical source identity',
  queue.includes('recoveryIdentity: JSON.stringify') &&
    queue.includes('sourcePath: source?.sourceFile ?? path')
);
check(
  'merge checkpoint signature includes sampled source content, ranges, quality and the selected output target',
  engine.includes('TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12') &&
    engine.includes('sampledFileFingerprint(') &&
    engine.includes('contentSample') &&
    engine.includes('Math.round(file.mtimeMs)') &&
    engine.includes('profileFacts') &&
    engine.includes('targetPath: recoveryPathKey(targetPath)')
);
check(
  'merge pending checkpoint uses an owned stable signature path instead of a job id',
  /checkpointFolder[\s\S]{0,700}join\(\s*workFolder\s*,\s*['"]Tubmedia['"]\s*,\s*['"]merge-checkpoints['"]\s*\)/.test(
    engine
  ) &&
    /ensureTubmediaOwnedDirectory\s*\(\s*checkpointFolder\s*,\s*['"]merge-checkpoints['"]\s*,\s*join\(\s*workFolder\s*,\s*['"]Tubmedia['"]\s*\)\s*\)/.test(
      engine
    ) &&
    engine.includes('checkpointSignature}.pending.mp4') &&
    !/\$\{\s*(?:jobId|job\.id|job\.jobId)\s*\}\.pending\.mp4/.test(engine)
);
check(
  'merge checkpoint namespace is accepted by the owned-directory type contract',
  ownership.includes("'merge-checkpoints'") || ownership.includes('"merge-checkpoints"')
);
check(
  'completion receipts bind reusable output to the exact input signature',
  engine.includes('readMergeCheckpointReceipt(') &&
    engine.includes('parsed.signature !== signature') &&
    engine.includes('writeMergeCheckpointReceipt(')
);
check(
  'reused candidates must pass media, visual, AV-sync and size checks',
  engine.includes('validateReusableMergeCandidate(') &&
    engine.includes('verifyPendingTwice(candidate') &&
    engine.includes('verifyVisualIntegrity(') &&
    engine.includes('validateMergeOutputSize([...inputInfos]')
);
check(
  'recovery decision table is used by the real merge branch',
  engine.includes('decideMergeRecoveryCandidate(candidate.kind, validation.ok)') &&
    engine.includes("recoveryDecision.action === 'rebuild'")
);
check(
  'invalid existing final files are preserved while owned checkpoints may be quarantined',
  engine.includes('if (recoveryDecision.quarantineCheckpoint)') &&
    engine.includes('Never delete or quarantine a user-visible final file') &&
    engine.includes('commitFileWithoutOverwrite(pending, final)')
);
check(
  'a valid final output skips concat and reports verified-final',
  engine.includes("recoveryMode === 'verified-final'") &&
    engine.indexOf('for (const candidate of candidates)') < engine.indexOf('this.concatCopy(')
);
check(
  'a valid pending file continues from final commit rather than concatenating again',
  engine.includes("'verified-checkpoint'") &&
    engine.includes('commitFileWithoutOverwrite(candidate.path, final)')
);
check(
  'fresh merges still use non-overwriting final commit and write a receipt',
  engine.includes('commitFileWithoutOverwrite(pending, final)') &&
    engine.includes("recoveryMode: 'new-merge'") &&
    engine.includes('reusedExisting: false')
);
check(
  'missing audio and excessive AV drift reject reuse',
  engine.includes('Thành phẩm thiếu audio stream.') && engine.includes('if (avDrift > tolerance)')
);
check(
  'changed source or output settings cannot reuse an old signature',
  engine.includes('file.size') &&
    engine.includes('Math.round(file.mtimeMs)') &&
    engine.includes('sourceStartSeconds') &&
    engine.includes('profileFacts')
);
check(
  'cancelled late work resumes from a stable checkpoint path',
  /checkpointFolder[\s\S]{0,700}['"]Tubmedia['"][\s\S]{0,220}['"]merge-checkpoints['"]/.test(engine) &&
    /ensureTubmediaOwnedDirectory\s*\(\s*checkpointFolder\s*,\s*['"]merge-checkpoints['"]\s*,\s*join\(\s*workFolder\s*,\s*['"]Tubmedia['"]\s*\)\s*\)/.test(
      engine
    ) &&
    !/checkpointFolder[\s\S]{0,700}['"]_merge-checkpoints['"]/.test(engine) &&
    engine.includes('checkpointSignature}.pending.mp4')
);
check(
  'verified reuse is persisted and logged with a merge-specific result',
  queue.includes('mergeRecoveryMode: result.recoveryMode') &&
    queue.includes('MERGE_REUSED_VERIFIED_OUTPUT') &&
    queue.includes('MERGE_RESUMED_VERIFIED_CHECKPOINT')
);
check(
  'only a reused final is marked skipped; a resumed checkpoint completes normally',
  queue.includes("return result.recoveryMode === 'verified-final'")
);
check(
  'legacy stable completion and merge-specific recovery stages stay synchronized',
  queue.includes('TUBMEDIA STABLE COMPLETION CONTRACT HOTFIX12R7') &&
    queue.includes("const finalStage = completionStatus === 'skipped' ? 'Đã tải trước đó' : 'Đã hoàn tất'") &&
    queue.includes('const synchronizedFinalStage =') &&
    queue.includes('progressStage: synchronizedFinalStage') &&
    queue.includes(
      'progressPhases: progressPhases(beforeDone, completionStatus, synchronizedFinalStage, 100)'
    )
);
check(
  'clip preprocessing also reuses only a signature-matched verified checkpoint',
  clip.includes('TUBMEDIA VERIFIED CLIP CHECKPOINT HOTFIX12') &&
    clip.includes('checkpointMatches') &&
    clip.includes('existingCheck.ok') &&
    clip.includes('tubmedia-checkpoint.json')
);
check(
  'invalid clip ranges fail clearly instead of producing a fake 0.01-second clip',
  clip.includes('item.timestampEndSeconds <= rangeStart') && clip.includes('Mốc cắt không hợp lệ')
);
check(
  'UI explains whether the app reused a final or resumed a checkpoint',
  ui.includes('Không ghép trùng thành phẩm') &&
    ui.includes('Đã tiếp tục đúng checkpoint') &&
    css.includes('TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12')
);
check(
  'Hotfix 11 TypeScript boundary narrowing is repaired',
  engine.includes('TUBMEDIA VISUAL BOUNDARY TYPE GUARD HOTFIX11R3') &&
    engine.includes('issue is VisualIntegrityIssue &')
);
check(
  'focused tests cover timeline-only and recovery safety contracts',
  test.includes('keeps the verified recovery gates in source') &&
    test.includes('never keys a merge checkpoint by the transient job id')
);
check(
  'focused tests execute the full final/checkpoint recovery decision matrix',
  test.includes('preserves an invalid final and rebuilds') &&
    test.includes('quarantines an invalid owned checkpoint') &&
    test.includes('commits a valid checkpoint')
);
check(
  'combined verification is permanent in npm run check',
  pkg.scripts?.['verify:timeline-merge-recovery'] ===
    'node scripts/verify-timeline-merge-recovery-hotfix12.mjs' &&
    pkg.scripts?.check?.includes('npm run verify:timeline-merge-recovery')
);

if (failures > 0)
  throw new Error(
    'Timeline + merge recovery Hotfix 12 verification failed: ' + failures + '/' + checks + ' checks failed.'
  );
console.log('Tubmedia timeline + merge recovery Hotfix 12 verification OK: ' + checks + ' checks.');
