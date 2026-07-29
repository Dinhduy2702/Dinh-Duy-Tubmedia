import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DOWNLOAD_LIST_POLICY_VERSION,
  REFERENCE_1080P_FORMAT_SELECTOR
} from '../src/shared/utils/download-quality.ts';

const engine = await readFile('src/main/downloader/download-engine.ts', 'utf8');
const repository = await readFile('src/main/database/repositories/media-source-repository.ts', 'utf8');
const stateMachine = await readFile('src/shared/utils/job-state-machine.ts', 'utf8');
const queueManager = await readFile('src/main/queue/queue-manager.ts', 'utf8');

assert.match(stateMachine, /export function initialJobStatus/);
assert.match(stateMachine, /case 'download':\s*return 'analyzing'/);
assert.match(stateMachine, /analyzing: new Set\(\[[^\]]*'downloading'/);
assert.match(stateMachine, /verifying: new Set\(\[[^\]]*'skipped'/);
assert.match(queueManager, /initialJobStatus\(job\.type\)/);
assert.match(queueManager, /initialJobStatus\(active\.job\.type\)/);
assert.doesNotMatch(queueManager, /startStatusForJobType/);
assert.equal(DOWNLOAD_LIST_POLICY_VERSION, 'download-list-multiplatform-v5');
const branches = REFERENCE_1080P_FORMAT_SELECTOR.split('/');
assert.match(branches[0], /height>=720/);
assert.match(branches[0], /\+ba/);
assert.equal(REFERENCE_1080P_FORMAT_SELECTOR.endsWith('bv*+ba/b'), true);
assert.match(repository, /clearFileCache/);
assert.match(repository, /source_file=NULL/);
assert.match(engine, /SOURCE_CACHE_MISSING/);
assert.match(engine, /SOURCE_CACHE_CORRUPT/);
assert.match(engine, /SOURCE_CACHE_QUALITY_FALLBACK/);
assert.match(engine, /DOWNLOAD_QUALITY_FALLBACK/);
assert.match(engine, /clearFileCache\(source\.id\)/);
assert.doesNotMatch(engine, /SOURCE_CACHE_INVALID/);

console.log('Recovery upgrade verification OK: queue, cache self-heal and quality fallback.');
