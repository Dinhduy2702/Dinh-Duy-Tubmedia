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

const [verifier, merge, queue, test, pkgText] = await Promise.all([
  source('src/main/media/file-verifier.ts'),
  source('src/main/merge/merge-engine.ts'),
  source('src/main/queue/queue-manager.ts'),
  source('tests/unit/merge-visual-boundary-hotfix11.test.ts'),
  source('package.json')
]);
const pkg = JSON.parse(pkgText);

check('strict boundary classifier is integrated', verifier.includes('TUBMEDIA STRICT VISUAL BOUNDARY POLICY HOTFIX11') && verifier.includes('classifyShortVisualBoundaryTransition'));
check('global FFmpeg black/freeze detector thresholds are unchanged', verifier.includes("'blackdetect=d=0.08:pix_th=0.02,freezedetect=n=-60dB:d=1'"));
check('short black acceptance is capped at 0.35 seconds', verifier.includes('SHORT_BOUNDARY_BLACK_MAX_SECONDS = 0.35'));
check('short freeze acceptance is capped at 1.25 seconds', verifier.includes('SHORT_BOUNDARY_FREEZE_MAX_SECONDS = 1.25'));
check('accepted issue must stay within 0.35 seconds of a real concat boundary', verifier.includes('SHORT_BOUNDARY_EDGE_WINDOW_SECONDS = 0.35'));
check('decode failures can never become boundary transitions', verifier.includes("issue.type !== 'black' && issue.type !== 'freeze'"));
check('merge policy uses an explicit NodeNext-compatible type guard', merge.includes('TUBMEDIA VISUAL BOUNDARY TYPE GUARD HOTFIX11R3') && merge.includes("issue is VisualIntegrityIssue & { type: 'black' | 'freeze' }") && !merge.includes("if (transition && (issue.type === 'black' || issue.type === 'freeze'))"));
check('boundary policy runs before the expensive repair branch', merge.indexOf('acceptShortBoundaryTransitions();') < merge.indexOf('const boundaryCorruption'));
check('boundary policy is re-applied after the bounded repair verification', merge.split('acceptShortBoundaryTransitions();').length - 1 >= 2);
check('source-origin reconciliation still runs before boundary classification', merge.indexOf('reconcileVisualIssuesWithOriginalSources') < merge.indexOf('acceptShortBoundaryTransitions();'));
check('genuine visual failures still use quarantine', merge.includes("phase: 'visual-integrity-verification'") && merge.includes('await this.quarantine.move'));
check('final output still commits without overwrite', merge.includes('commitFileWithoutOverwrite(pending, final)'));
check('success warnings are short Vietnamese explanations', merge.includes('Đã ghép an toàn: Tubmedia nhận diện'));
check('queue persists structured boundary diagnostics', queue.includes('mergeVisualBoundaryTransitions: result.visualBoundaryTransitions'));
check('queue warning logs include structured boundary diagnostics', queue.includes('visualBoundaryTransitions: result.visualBoundaryTransitions'));
check('focused unit tests cover safe and unsafe cases', test.includes('accepts the reported 0.225622-second black transition') && test.includes('never accepts decoder failures'));
check('verification command is permanent in npm run check', pkg.scripts?.['verify:merge-visual-boundary'] === 'node scripts/verify-merge-visual-boundary-hotfix11.mjs' && pkg.scripts?.check?.includes('npm run verify:merge-visual-boundary'));

if (failures > 0) throw new Error('Merge visual-boundary Hotfix 11 verification failed: ' + failures + '/' + checks + ' checks failed.');
console.log('Tubmedia merge visual-boundary Hotfix 11 verification OK: ' + checks + ' checks.');
