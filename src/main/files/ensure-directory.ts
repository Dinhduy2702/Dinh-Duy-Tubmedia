import { mkdir, stat } from 'node:fs/promises';

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists without calling mkdir on an existing Windows drive root.
 * Windows can return EPERM for mkdir('E:\', { recursive: true }) even when the root is valid.
 */
export async function ensureDirectory(path: string): Promise<void> {
  if (await isDirectory(path)) return;

  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    if ((errorCode(error) === 'EPERM' || errorCode(error) === 'EEXIST') && await isDirectory(path)) {
      return;
    }
    throw error;
  }

  if (!(await isDirectory(path))) {
    throw new Error(`Không thể tạo hoặc truy cập thư mục: ${path}`);
  }
}
