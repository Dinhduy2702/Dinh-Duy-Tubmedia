export type RetryClass = 'retryable' | 'non_retryable' | 'authentication' | 'disk' | 'tool';
export function classifyFailure(text: string): RetryClass {
  const lower = text.toLowerCase();
  if (/disk full|no space left/.test(lower)) return 'disk';
  if (/not found|enoent|tool missing/.test(lower)) return 'tool';
  if (/private video|login required|sign in|confirm (?:you(?:'|’)?re|you are) not a bot|not a bot|cookies|cookies-from-browser|authentication|members.only|age.restricted|registered users|account required/.test(lower)) return 'authentication';
  if (/invalid url|unsupported url|video unavailable|deleted|permission denied|geo.?restricted/.test(lower)) return 'non_retryable';
  if (/timeout|timed out|connection reset|429|403|fragment|cdn|temporary|locked|did not get any data blocks|unable to download video data|remote end closed connection/.test(lower)) return 'retryable';
  return 'non_retryable';
}
export function retryDelayMs(attempt: number, base = 1000, max = 60_000): number {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}
