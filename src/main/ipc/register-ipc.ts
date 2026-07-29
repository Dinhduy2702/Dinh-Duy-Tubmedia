import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC } from '@shared/contracts/channels.js';
import {
  backupCreateSchema,
  browserCookieSchema,
  clearLogsSchema,
  clearWorkbenchSchema,
  chooseFolderSchema,
  clipboardTextSchema,
  cookieTextSchema,
  downloadLaneSchema,
  downloadMergeSchema,
  downloadLaneDraftSchema,
  downloadMergeDraftSchema,
  backupRestoreSchema,
  idSchema,
  idsSchema,
  importInputSchema,
  jobIdSchema,
  logQuerySchema,
  parseInputSchema,
  projectCreateSchema,
  projectIdSchema,
  projectUpdateSchema,
  qualityProfileSchema,
  queueRemoveSchema,
  reorderSchema,
  resourceProfileSchema,
  settingsPatchSchema,
  saveTextFileSchema,
  showPathSchema,
  toolNameSchema,
  verifyFileSchema,
  workbenchSlotSchema,
  systemCleanupRequestSchema,
  systemCleanupRunSchema,
  quickDownloadRequestSchema,
  quickDownloadTaskSchema
} from '@shared/schemas/ipc.js';
import type { AppSettings } from '@shared/types/domain.js';
import { InvalidInputError } from '@shared/errors/app-errors.js';
import type { ZodType } from 'zod';
import { exportSanitizedLogTree } from '../logging/diagnostic-exporter.js';
import { redactSecrets } from '@shared/utils/secret-redaction.js';
import type { AppContext } from '../app/app-context.js';

import { SystemCleanupService } from '../system/system-cleanup-service.js';
import { QuickDownloadService } from '../download/quick-download-service.js';
type MaybePromise<T> = T | Promise<T>;

export function registerIpc(ctx: AppContext): void {
  // TUBMEDIA_FEATURE_SERVICES
  const systemCleanup = new SystemCleanupService();
  const quickDownload = new QuickDownloadService();

  const handle = <Input, Output>(
    channel: string,
    schema: ZodType<Input>,
    handler: (value: Input) => MaybePromise<Output>
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, raw: unknown) => {
      ctx.sender.assert(event);
      return handler(schema.parse(raw));
    });
  };

  const noArgs = <Output>(channel: string, handler: () => MaybePromise<Output>): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
      ctx.sender.assert(event);
      return handler();
    });
  };

  const configureCookies = async <Output>(action: () => MaybePromise<Output>): Promise<Output> => {
    const result = await action();
    ctx.queue.resumeCookieBlockedJobs();
    return result;
  };

  noArgs(IPC.app.getBootstrap, () => {
    return {
      settings: ctx.settings.get(),
      profiles: ctx.settings.profiles(),
      projects: ctx.projects.list(),
      jobs: ctx.queue.list(),
      tools: ctx.tools.list(),
      hardware: ctx.settings.quickHardware()
    };
  });
  noArgs(IPC.app.getSystemStats, () => ctx.systemStats.sample());
  handle(IPC.app.showPath, showPathSchema, ({ path }) => shell.openPath(path));
  noArgs(IPC.app.readClipboard, () => clipboard.readText());
  handle(IPC.app.writeClipboard, clipboardTextSchema, ({ text }) => {
    clipboard.writeText(text);
    return true;
  });

  noArgs(IPC.workbench.state, () => ctx.workbench.state());
  handle(IPC.workbench.startDownload, downloadLaneSchema, (value) => ctx.workbench.startDownload(value));
  handle(IPC.workbench.startMerge, downloadMergeSchema, (value) => ctx.workbench.startMerge(value));
  handle(IPC.workbench.saveDownloadDraft, downloadLaneDraftSchema, (value) =>
    ctx.workbench.saveDownloadDraft(value)
  );
  handle(IPC.workbench.saveMergeDraft, downloadMergeDraftSchema, (value) =>
    ctx.workbench.saveMergeDraft(value)
  );
  handle(IPC.workbench.storage, workbenchSlotSchema, ({ slot }) => ctx.workbench.storage(slot));
  handle(IPC.workbench.pause, workbenchSlotSchema, ({ slot }) => ctx.workbench.pause(slot));
  handle(IPC.workbench.resume, workbenchSlotSchema, ({ slot }) => ctx.workbench.resume(slot));
  handle(IPC.workbench.cancel, workbenchSlotSchema, ({ slot }) => ctx.workbench.cancel(slot));
  handle(IPC.workbench.clearProgress, clearWorkbenchSchema, ({ slot }) => ctx.workbench.clearProgress(slot));
  handle(IPC.workbench.clearLogs, clearWorkbenchSchema, ({ slot }) => ctx.workbench.clearLogs(slot));
  handle(IPC.workbench.remove, workbenchSlotSchema, ({ slot }) => ctx.workbench.remove(slot));
  noArgs(IPC.workbench.removeAll, () => ctx.workbench.removeAll());

  noArgs(IPC.projects.list, () => ctx.projects.list());
  handle(IPC.projects.get, idSchema, (id) => ctx.projects.get(id));
  handle(IPC.projects.create, projectCreateSchema, (input) =>
    ctx.projects.create({
      name: input.name,
      sourceFolder: input.sourceFolder,
      tempFolder: input.tempFolder,
      outputFolder: input.outputFolder,
      finalFileName: input.finalFileName,
      qualityProfileId: input.qualityProfileId,
      resourceProfileId: input.resourceProfileId,
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.exportTimelineTxt !== undefined ? { exportTimelineTxt: input.exportTimelineTxt } : {})
    })
  );
  handle(IPC.projects.update, projectUpdateSchema, ({ id, ...input }) => {
    const patch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.sourceFolder !== undefined ? { sourceFolder: input.sourceFolder } : {}),
      ...(input.tempFolder !== undefined ? { tempFolder: input.tempFolder } : {}),
      ...(input.outputFolder !== undefined ? { outputFolder: input.outputFolder } : {}),
      ...(input.finalFileName !== undefined ? { finalFileName: input.finalFileName } : {}),
      ...(input.qualityProfileId !== undefined ? { qualityProfileId: input.qualityProfileId } : {}),
      ...(input.resourceProfileId !== undefined ? { resourceProfileId: input.resourceProfileId } : {}),
      ...(input.exportTimelineTxt !== undefined ? { exportTimelineTxt: input.exportTimelineTxt } : {})
    };
    return ctx.projects.update(id, patch);
  });
  handle(IPC.projects.archive, idSchema, (id) => ctx.projects.archive(id));
  handle(IPC.projects.restore, idSchema, (id) => ctx.projects.restore(id));
  handle(IPC.projects.remove, idSchema, (id) => ctx.projects.remove(id));
  handle(IPC.projects.duplicate, idSchema, (id) => ctx.projects.duplicate(id));

  handle(IPC.input.parse, parseInputSchema, ({ text }) => ctx.input.parse(text));
  handle(IPC.input.importText, importInputSchema, ({ projectId, text, mode }) =>
    ctx.input.import(projectId, text, mode)
  );
  handle(IPC.input.listItems, projectIdSchema, ({ projectId }) => ctx.input.list(projectId));
  handle(IPC.input.reorder, reorderSchema, ({ projectId, itemIds }) => ctx.input.reorder(projectId, itemIds));
  handle(IPC.input.removeItems, idsSchema, ({ ids }) => ctx.input.remove(ids));

  noArgs(IPC.cookies.status, () => ctx.cookies.status());
  handle(IPC.cookies.saveText, cookieTextSchema, ({ text }) =>
    configureCookies(() => ctx.cookies.saveText(text))
  );
  handle(IPC.cookies.useBrowser, browserCookieSchema, ({ browser, profile }) =>
    configureCookies(() => ctx.cookies.useBrowser(browser, profile))
  );
  handle(IPC.cookies.useFile, showPathSchema, ({ path }) =>
    configureCookies(() => ctx.cookies.useFile(path))
  );
  noArgs(IPC.cookies.clear, () => ctx.cookies.clear());

  handle(IPC.dialogs.chooseFolder, chooseFolderSchema, async ({ defaultPath }) => {
    const result = await dialog.showOpenDialog({
      ...(defaultPath ? { defaultPath } : {}),
      properties: ['openDirectory', 'createDirectory']
    });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    return ctx.paths.ensureWritable(selected);
  });
  noArgs(IPC.dialogs.chooseTextFile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Tệp văn bản', extensions: ['txt'] }]
    });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    return { path: selected, text: await readFile(selected, 'utf8') };
  });
  noArgs(IPC.dialogs.chooseCookiesFile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Cookies (Netscape hoặc JSON)', extensions: ['txt', 'json'] }]
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  noArgs(IPC.dialogs.chooseBackupFile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Bản sao lưu video Tubmedia', extensions: ['sqlite'] }]
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(IPC.dialogs.saveTextFile, saveTextFileSchema, async ({ defaultName, content, defaultFolder }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultFolder ? join(defaultFolder, defaultName) : defaultName,
      filters: [{ name: 'Tệp văn bản', extensions: ['txt'] }]
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = result.filePath.toLowerCase().endsWith('.txt')
      ? result.filePath
      : `${result.filePath}.txt`;
    await writeFile(filePath, content, 'utf8');
    return filePath;
  });

  noArgs(IPC.settings.get, () => ctx.settings.get());
  handle(IPC.settings.update, settingsPatchSchema, (patch) => {
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    ) as Partial<AppSettings>;

    return ctx.settings.update(definedPatch);
  });
  noArgs(IPC.settings.hardware, () => ctx.settings.detectHardware(true));
  noArgs(IPC.settings.profiles, () => ctx.settings.profiles());
  handle(IPC.settings.saveResourceProfile, resourceProfileSchema, (profile) =>
    ctx.settings.saveResource(profile)
  );
  handle(IPC.settings.saveQualityProfile, qualityProfileSchema, (profile) => {
    const { bitrateMode, ...requiredProfile } = profile;
    return ctx.settings.saveQuality({
      ...requiredProfile,
      ...(bitrateMode !== undefined ? { bitrateMode } : {})
    });
  });
  noArgs(IPC.settings.recommend, () => ctx.settings.recommend());

  noArgs(IPC.queue.list, () => ctx.queue.list());
  handle(IPC.queue.enqueueProject, projectIdSchema, ({ projectId }) => ctx.queue.enqueueProject(projectId));
  noArgs(IPC.queue.pauseAll, () => ctx.queue.pauseAll());
  noArgs(IPC.queue.resumeAll, () => ctx.queue.resumeAll());
  handle(IPC.queue.pause, jobIdSchema, ({ jobId }) => ctx.queue.pause(jobId));
  handle(IPC.queue.resume, jobIdSchema, ({ jobId }) => ctx.queue.resume(jobId));
  handle(IPC.queue.cancel, jobIdSchema, ({ jobId }) => ctx.queue.cancel(jobId));
  handle(IPC.queue.retry, jobIdSchema, ({ jobId }) => ctx.queue.retry(jobId));
  handle(IPC.queue.retryFailed, projectIdSchema.partial(), ({ projectId }) =>
    ctx.queue.retryFailed(projectId)
  );
  handle(IPC.queue.remove, queueRemoveSchema, ({ jobId, deleteOutput }) =>
    ctx.queue.remove(jobId, deleteOutput)
  );
  handle(IPC.queue.clearFinished, projectIdSchema.partial(), ({ projectId }) =>
    ctx.queue.clearFinished(projectId)
  );

  noArgs(IPC.tools.list, () => ctx.tools.list());
  noArgs(IPC.tools.healthCheck, async () => {
    const statuses = await ctx.tools.healthCheck();
    ctx.queue.recoverToolBlocked();
    return statuses;
  });
  noArgs(IPC.tools.checkUpdates, () => ctx.toolUpdates.check());
  handle(IPC.tools.update, toolNameSchema, async ({ name }) => {
    await ctx.toolUpdates.update(name);
    ctx.queue.recoverToolBlocked();
  });
  noArgs(IPC.tools.updateAll, async () => {
    const statuses = await ctx.toolUpdates.updateAll();
    ctx.queue.recoverToolBlocked();
    return statuses;
  });
  noArgs(IPC.tools.repairAll, async () => {
    const statuses = await ctx.toolUpdates.repairAll();
    ctx.queue.recoverToolBlocked();
    return statuses;
  });
  handle(IPC.tools.rollback, toolNameSchema, async ({ name }) => {
    await ctx.toolUpdates.rollback(name);
    ctx.queue.recoverToolBlocked();
  });
  noArgs(IPC.tools.openFolder, async () => {
    const folder = await ctx.tools.ensureWritableToolFolder();
    await shell.openPath(folder);
    return folder;
  });

  handle(IPC.media.analyze, showPathSchema, ({ path }) => ctx.analyzer.analyze(path));
  handle(IPC.media.verifyFile, verifyFileSchema, ({ path, level }) => ctx.verifier.verify(path, level));
  handle(IPC.media.mergeProject, projectIdSchema, ({ projectId }) => ctx.queue.enqueueProject(projectId));

  handle(IPC.logs.list, logQuerySchema, (query) =>
    ctx.logRepo.list({
      limit: query.limit,
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.jobId !== undefined ? { jobId: query.jobId } : {}),
      ...(query.level !== undefined ? { level: query.level } : {}),
      ...(query.module !== undefined ? { module: query.module } : {})
    })
  );
  noArgs(IPC.logs.openFolder, () => shell.openPath(join(ctx.userData, 'logs')));
  handle(IPC.logs.clear, clearLogsSchema, ({ projectId }) => {
    const removed = projectId ? ctx.logger.clearProject(projectId) : ctx.logger.clearAll();
    return { removed };
  });
  noArgs(IPC.logs.exportDiagnostics, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const source = join(ctx.userData, 'logs');
    const target = join(selected, `VideoStudio-Diagnostics-${Date.now()}`);
    await mkdir(target, { recursive: true });
    await exportSanitizedLogTree(source, join(target, 'logs'));
    const settings = ctx.settings.get();
    const diagnostic = {
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      hardware: await ctx.settings.detectHardware(),
      tools: ctx.tools.list(),
      settings: {
        ...settings,
        cookiesFilePath: settings.cookiesFilePath ? '[CONFIGURED]' : '',
        proxy: settings.proxy ? '[CONFIGURED]' : ''
      },
      projects: ctx.projects.list().map((project) => ({
        id: project.id,
        name: project.name,
        code: project.code,
        status: project.status
      })),
      jobs: ctx.queue.list().map((job) => ({
        id: job.id,
        projectId: job.projectId,
        type: job.type,
        status: job.status,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage
      }))
    };
    await writeFile(
      join(target, 'diagnostic.json'),
      JSON.stringify(redactSecrets(diagnostic), null, 2),
      'utf8'
    );
    return target;
  });

  handle(IPC.backups.create, backupCreateSchema, ({ projectId, includeMedia }) =>
    ctx.backups.create(projectId, includeMedia)
  );
  handle(IPC.backups.preview, showPathSchema, ({ path }) => ctx.backups.preview(path));
  handle(IPC.backups.restore, backupRestoreSchema, ({ path, mode }) => {
    if (ctx.queue.activeCount() > 0 || ctx.processes.count() > 0) {
      throw new InvalidInputError('Không thể phục hồi khi còn tác vụ hoặc tiến trình đang chạy.');
    }
    const result = ctx.backups.restore(path, mode);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);
    return result;
  });

  // TUBMEDIA_SYSTEM_CLEANUP_HANDLERS
  handle(IPC.systemCleanup.start, systemCleanupRequestSchema, (request) => {
    if (ctx.queue.activeCount() > 0 || ctx.processes.count() > 0 || quickDownload.isActive()) {
      throw new InvalidInputError(
        'Không thể dọn dẹp khi Tubmedia còn tác vụ tải, cắt, chuẩn hóa, ghép hoặc tải nhanh đang chạy.'
      );
    }
    return systemCleanup.start(request);
  });
  handle(IPC.systemCleanup.status, systemCleanupRunSchema, ({ runId }) => systemCleanup.status(runId));
  handle(IPC.systemCleanup.cancel, systemCleanupRunSchema, ({ runId }) => systemCleanup.cancel(runId));

  // TUBMEDIA_QUICK_DOWNLOAD_HANDLERS
  noArgs(IPC.quickDownload.defaults, () => ({
    outputDirectory: quickDownload.defaultOutputDirectory()
  }));
  handle(IPC.quickDownload.chooseDirectory, chooseFolderSchema, async ({ defaultPath }) => {
    const result = await dialog.showOpenDialog({
      ...(defaultPath ? { defaultPath } : {}),
      properties: ['openDirectory', 'createDirectory']
    });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    await ctx.paths.ensureWritable(selected);
    return selected;
  });
  handle(IPC.quickDownload.start, quickDownloadRequestSchema, (request) => {
    if (systemCleanup.isActive() || ctx.queue.activeCount() > 0 || ctx.processes.count() > 0) {
      throw new InvalidInputError(
        'Hãy tạm dừng tác vụ đang chạy hoặc chờ dọn dẹp hoàn tất trước khi dùng Tải nhanh 1 video.'
      );
    }
    return quickDownload.start(request);
  });
  handle(IPC.quickDownload.status, quickDownloadTaskSchema, ({ taskId }) => quickDownload.status(taskId));
  handle(IPC.quickDownload.cancel, quickDownloadTaskSchema, ({ taskId }) => quickDownload.cancel(taskId));
  handle(IPC.quickDownload.revealOutput, quickDownloadTaskSchema, ({ taskId }) =>
    quickDownload.revealOutput(taskId)
  );

  noArgs(IPC.updates.status, () => ctx.appUpdates.getStatus());
  noArgs(IPC.updates.check, () => ctx.appUpdates.check());
  noArgs(IPC.updates.download, () => ctx.appUpdates.download());
  noArgs(IPC.updates.install, () => ctx.appUpdates.install());
}
