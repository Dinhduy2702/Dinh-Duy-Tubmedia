import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('network recovery wiring R54', () => {
  it('uses yt-dlp dynamic clients and refreshes extractor data on queue retries', () => {
    const engine = readFileSync('src/main/downloader/download-engine.ts', 'utf8');

    expect(engine).not.toContain('youtube:player_client=default,web_safari');
    expect(engine).toContain("...(job.attempts > 0 ? ['--no-cache-dir'] : [])");
    expect(engine).toContain('Math.min(job.attempts > 0 ? 1 : 8');
    expect(engine).toContain("clientPolicy: 'yt-dlp-dynamic-default-no-manual-web-safari'");
  });

  it('opens one project warning before emitting an individual terminal notice', () => {
    const queue = readFileSync('src/main/queue/queue-manager.ts', 'utf8');
    const circuit = queue.indexOf('const circuitOpened = await this.openCircuitAfterRepeatedFailure');
    const fallbackNotice = queue.indexOf(
      'if (!circuitOpened) this.notifyJobFailure(code, finalMessage, job, true)'
    );

    expect(circuit).toBeGreaterThan(-1);
    expect(fallbackNotice).toBeGreaterThan(circuit);
    expect(queue).toContain('id: `job-failure-${scope}-${code}`');
    expect(queue).not.toContain('id: randomUUID()');
    expect(queue).toContain("job && code !== 'NETWORK_CIRCUIT_OPEN'");
  });

  it('routes non-error UI results through the transient attention queue', () => {
    const store = readFileSync('src/renderer/src/stores/app-store.ts', 'utf8');
    expect(store).toContain('shouldRouteIssueToAttention(issue.tone)');
  });
});
