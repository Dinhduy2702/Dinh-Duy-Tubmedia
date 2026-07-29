export type WorkbenchPathKey =
  | 'download-output'
  | 'download-temp'
  | 'merge-source'
  | 'merge-temp'
  | 'merge-output';

const PREFIX = 'tubmedia.workbench.last-path.';

export function loadWorkbenchPath(key: WorkbenchPathKey): string | null {
  try {
    const value = window.localStorage.getItem(`${PREFIX}${key}`)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function saveWorkbenchPath(key: WorkbenchPathKey, value: string): void {
  const normalized = value.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(`${PREFIX}${key}`, normalized);
  } catch {
    // A locked or unavailable renderer storage must never block a download workflow.
  }
}
