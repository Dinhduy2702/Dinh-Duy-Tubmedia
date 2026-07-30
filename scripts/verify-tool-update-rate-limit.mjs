import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

const root = process.cwd();
const sourcePath = walk(join(root, 'src', 'main')).find((filePath) => {
  const source = readFileSync(filePath, 'utf8');
  return source.includes('class ToolUpdateService') && source.includes('githubLatest');
});

if (!sourcePath) {
  throw new Error('FAIL: ToolUpdateService source was not found.');
}

const source = readFileSync(sourcePath, 'utf8');
const checks = [];

function check(label, condition) {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }

  checks.push(label);
  console.log(`PASS: ${label}`);
}

check('githubLatest uses resilient GitHub fetch', source.includes('tubmediaFetchGitHubRelease('));
check('requests are coalesced', source.includes('tubmediaGitHubReleaseInflight'));
check('release results are cached', source.includes('TUBMEDIA_GITHUB_RELEASE_CACHE_TTL_MS'));
check('GitHub User-Agent is sent', source.includes("'User-Agent'"));
check('GitHub API version is sent', source.includes("'X-GitHub-Api-Version'"));
check(
  '403 and 429 are handled',
  source.includes('apiResponse.status === 403') && source.includes('apiResponse.status === 429')
);
check('Retry-After is respected', source.includes("'retry-after'"));
check('rate-limit reset is respected', source.includes("'x-ratelimit-reset'"));
check('HTML release fallback exists', source.includes('tubmediaGitHubHtmlReleaseFallback'));
check('expanded release assets are parsed', source.includes('/releases/expanded_assets/'));
check('no embedded GitHub token exists', !/gh[pousr]_[A-Za-z0-9_]{20,}/.test(source));

console.log(`Tool update rate-limit verification OK: ${checks.length} checks.`);
