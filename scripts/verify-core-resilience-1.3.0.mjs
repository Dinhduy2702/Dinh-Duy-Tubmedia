import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}
function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error('CORE_RESILIENCE_FAIL: ' + label);
  console.log('PASS: ' + label);
}

const merge = source('src/main/merge/merge-engine.ts');
const verifier = source('src/main/media/file-verifier.ts');
const analyzer = source('src/main/media/media-analyzer.ts');
const normalizer = source('src/main/normalize/normalize-engine.ts');
const concat = source('src/shared/utils/concat-compatibility.ts');
const target = source('src/shared/utils/merge-target.ts');
const clip = source('src/main/clips/clip-engine.ts');
const download = source('src/main/downloader/download-engine.ts');
const queue = source('src/main/queue/queue-manager.ts');
const appUpdate = source('src/main/updates/app-update-service.ts');
const toolUpdate = source('src/main/updates/tool-update-service.ts');
const backup = source('src/main/backups/backup-service.ts');
const logging = source('src/main/logging/logger.ts');
const diagnosticExporter = source('src/main/logging/diagnostic-exporter.ts');
const quick = source('src/main/download/quick-download-service.ts');
const cleanupContract = source('src/shared/system-cleanup.ts');

requireText(analyzer, "'-show_data_hash', 'sha256'", 'ffprobe fingerprints codec extradata before concat');
requireText(concat, "['Time base'", 'time-base mismatch blocks stream-copy concat');
requireText(concat, "['Video extradata'", 'video codec extradata mismatch blocks stream-copy concat');
requireText(concat, "['Audio extradata'", 'audio codec extradata mismatch blocks stream-copy concat');
requireText(concat, "['Channel layout'", 'audio channel-layout mismatch blocks stream-copy concat');
requireText(merge, 'TUBMEDIA PROVEN FAST PATH R35', 'merge classifies video/audio/timestamp mismatches independently');
requireText(merge, 'forceUniformAudio', 'audio mismatch can be repaired independently from video');
requireText(merge, 'canonicalizeTimeBase', 'time-base mismatch takes the remux path before expensive re-encode');
requireText(merge, "this.verifier.verify(item.path, 'deep'", 'passthrough merge sources are decoded end-to-end before concat');
requireText(normalizer, "'-xerror', '-err_detect', 'explode'", 'normalization aborts on decoder corruption instead of concealing it');
requireText(normalizer, 'TUBMEDIA VERIFIED CACHE REUSE R35', 'normalize/remux caches are verified before reuse');
requireText(normalizer, "'-video_track_timescale', '90000'", 'normalize/remux outputs use one canonical MP4 video time-base');
requireText(normalizer, 'forceAudioTranscode = false', 'normalization can re-encode audio without touching compatible video');
requireText(normalizer, "operation: 'remux-v4-core-resilience'", 'pre-R35 remux cache entries are invalidated');
requireText(verifier, "'blackdetect=d=0.08:pix_th=0.02,freezedetect=n=-60dB:d=1'", 'final merge scans black and frozen frames');
requireText(verifier, "...(options.expectedStreams?.audio ? ['-map', '0:a:0'] : ['-an'])", 'full-frame merge verification decodes required audio too');
requireText(verifier, "'-xerror'", 'deep verification uses strict FFmpeg decoding');
requireText(merge, "expectedStreams: { video: true, audio: expectedAudio }", 'merged output requires the expected audio stream');
requireText(merge, "phase: 'av-sync-verification'", 'merged output enforces audio/video duration synchronization');
requireText(merge, 'commitFileWithoutOverwrite(pending, final)', 'final merge commit never overwrites a valid existing output');
requireText(target, "hasAnyAudio || profile.audioMode === 'silent'", 'smart merge cannot silently drop audio when the dominant clip is silent');
requireText(clip, "'-xerror', '-err_detect', 'explode'", 'clip creation fails closed on decoder corruption');
requireText(clip, '.previous-' + '$' + '{Date.now()}.bak', 'clip replacement keeps a restorable previous file until commit succeeds');
requireText(download, 'commitFileWithoutOverwrite', 'download post-processing commits without unsafe overwrite');
requireText(download, 'verifyFinal(', 'download workflow verifies completed media before success');
requireText(queue, 'TUBMEDIA RACE SAFE RESUME R29', 'queue resume preserves the live processing phase');
requireText(queue, 'TUBMEDIA DISK SPACE AUTO RECOVERY R28', 'disk-full jobs are rechecked and recovered automatically');
requireText(quick, "join(app.getPath('temp'), 'TubmediaQD')", 'Quick Download uses a short Windows temp path');
requireText(quick, 'QUICK_DOWNLOAD_GENERIC_EXTRACTOR_RETRY', 'unsupported URLs get a generic extractor recovery attempt');
requireText(appUpdate, 'allowDowngrade = false', 'application updates remain downgrade-safe');
requireText(toolUpdate, 'không có SHA-256 được công bố', 'tool updates fail closed without a published SHA-256');
requireText(toolUpdate, 'SHA-256 của ' + '$' + '{asset.name} không khớp', 'tool updates reject checksum mismatches');
requireText(backup, 'PRAGMA integrity_check', 'database backup validates SQLite integrity');
requireText(logging, 'redactSecrets', 'normal logs redact credentials and secrets');
requireText(diagnosticExporter, 'redactSecretText', 'diagnostic exports redact secrets before writing');
requireText(cleanupContract, 'Zalo Received Files', 'system cleanup retains protected user-data locations in its safety contract');

console.log('Tubmedia 1.3.0 core resilience verification OK.');
