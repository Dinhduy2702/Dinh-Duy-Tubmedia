export const VERSION_PATTERN: RegExp;
export const CHANGELOG_STUB_MARKER: string;
export const VERSION_FILES: Readonly<{
  packageJson: string;
  packageLock: string;
  appConstants: string;
  workflow: string;
  changelog: string;
  sourceManifest: string;
}>;
export function isValidVersion(value: unknown): value is string;
export function compareVersions(left: string, right: string): -1 | 0 | 1;
export function planVersionBump(
  files: Record<string, string>,
  newVersion: string
): { from: string; to: string; files: Record<string, string> };
export function collectVersionProblems(files: Record<string, string>): string[];
export function findHardcodedVersionChecks(fileName: string, text: string): string[];
