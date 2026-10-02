import type { AppSettings, Project, QueueJob } from '@shared/types/domain.js';
import type { TemporaryCleanupOptions } from './temporary-cleanup.js';

/**
 * Danh sách thư mục/tệp KHÔNG được đụng tới khi dọn tạm (Đợt 2, 2026-10-02): mọi thư mục người dùng đã
 * chọn (nguồn/tạm/thành phẩm của mọi danh sách + thư mục mặc định) và mọi tệp thành phẩm/nguồn đã biết.
 * Mọi nơi gọi cleanupTemporaryArtifacts phải truyền kết quả hàm này.
 */
export function buildCleanupProtection(input: {
  projects: ReadonlyArray<Pick<Project, 'sourceFolder' | 'tempFolder' | 'outputFolder'>>;
  settings: Pick<AppSettings, 'defaultSourceFolder' | 'defaultTempFolder' | 'defaultOutputFolder'>;
  jobs: ReadonlyArray<Pick<QueueJob, 'input'>>;
  sourceFiles: readonly string[];
}): Required<TemporaryCleanupOptions> {
  const folders = [
    input.settings.defaultSourceFolder,
    input.settings.defaultTempFolder,
    input.settings.defaultOutputFolder,
    ...input.projects.flatMap((project) => [project.sourceFolder, project.tempFolder, project.outputFolder])
  ];
  const files = [
    ...input.sourceFiles,
    ...input.jobs.map((job) => job.input.outputPath).filter((path): path is string => typeof path === 'string')
  ];
  return {
    protectedFolders: [...new Set(folders.filter((path) => typeof path === 'string' && path.trim()))],
    protectedFiles: [...new Set(files.filter((path) => path.trim()))]
  };
}
