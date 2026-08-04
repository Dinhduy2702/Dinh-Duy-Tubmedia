export type AppVersionRelation = -1 | 0 | 1;

interface ParsedAppVersion {
  core: number[];
  prerelease: string[];
}

function parseVersion(value: string): ParsedAppVersion | null {
  const withoutBuild = value.trim().replace(/^v/i, '').split('+', 1)[0];
  if (!withoutBuild) return null;

  const dashIndex = withoutBuild.indexOf('-');
  const coreText = dashIndex >= 0 ? withoutBuild.slice(0, dashIndex) : withoutBuild;
  const prereleaseText = dashIndex >= 0 ? withoutBuild.slice(dashIndex + 1) : '';
  const coreParts = coreText.split('.');

  if (coreParts.length === 0 || coreParts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  const core = coreParts.map((part) => Number(part));

  if (core.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    return null;
  }

  const prerelease = prereleaseText ? prereleaseText.split('.').filter(Boolean) : [];

  return { core, prerelease };
}

function comparePrerelease(left: string[], right: string[]): AppVersionRelation {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);

    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);
      return leftNumber < rightNumber ? -1 : 1;
    }

    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }

    return leftPart.localeCompare(rightPart, 'en', {
      numeric: true,
      sensitivity: 'base'
    }) < 0
      ? -1
      : 1;
  }

  return 0;
}

export function compareAppVersions(
  candidateVersion: string,
  currentVersion: string
): AppVersionRelation | null {
  const candidate = parseVersion(candidateVersion);
  const current = parseVersion(currentVersion);

  if (!candidate || !current) return null;

  const length = Math.max(candidate.core.length, current.core.length);

  for (let index = 0; index < length; index += 1) {
    const candidatePart = candidate.core[index] ?? 0;
    const currentPart = current.core[index] ?? 0;

    if (candidatePart === currentPart) continue;
    return candidatePart < currentPart ? -1 : 1;
  }

  return comparePrerelease(candidate.prerelease, current.prerelease);
}

export function isNewerAppVersion(
  candidateVersion: string | null | undefined,
  currentVersion: string | null | undefined
): boolean {
  if (!candidateVersion || !currentVersion) return false;

  return compareAppVersions(candidateVersion, currentVersion) === 1;
}
