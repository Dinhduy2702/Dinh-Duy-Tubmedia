import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@shared/contracts/channels.js';
import type { DesktopApi } from './api-types.js';
const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;
const on = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const wrapped = (_event: IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};
const api: DesktopApi = {
  workbench: {
    state: () => invoke(IPC.workbench.state),
    startDownload: (input) => invoke(IPC.workbench.startDownload, input),
    startMerge: (input) => invoke(IPC.workbench.startMerge, input),
    saveDownloadDraft: (input) => invoke(IPC.workbench.saveDownloadDraft, input),
    saveMergeDraft: (input) => invoke(IPC.workbench.saveMergeDraft, input),
    storage: (slot) => invoke(IPC.workbench.storage, { slot }),
    pause: (slot) => invoke(IPC.workbench.pause, { slot }),
    resume: (slot) => invoke(IPC.workbench.resume, { slot }),
    cancel: (slot) => invoke(IPC.workbench.cancel, { slot }),
    clearProgress: (slot) => invoke(IPC.workbench.clearProgress, { slot }),
    clearLogs: (slot) => invoke(IPC.workbench.clearLogs, { slot }),
    remove: (slot) => invoke(IPC.workbench.remove, { slot }),
    removeAll: () => invoke(IPC.workbench.removeAll)
  },
  app: {
    bootstrap: () => invoke(IPC.app.getBootstrap),
    systemStats: () => invoke(IPC.app.getSystemStats),
    showPath: (path) => invoke(IPC.app.showPath, { path }),
    readClipboard: () => invoke(IPC.app.readClipboard),
    writeClipboard: (text) => invoke(IPC.app.writeClipboard, { text })
  },
  projects: {
    list: () => invoke(IPC.projects.list),
    get: (id) => invoke(IPC.projects.get, id),
    create: (input) => invoke(IPC.projects.create, input),
    update: (input) => invoke(IPC.projects.update, input),
    archive: (id) => invoke(IPC.projects.archive, id),
    restore: (id) => invoke(IPC.projects.restore, id),
    remove: (id) => invoke(IPC.projects.remove, id),
    duplicate: (id) => invoke(IPC.projects.duplicate, id)
  },
  input: {
    parse: (text) => invoke(IPC.input.parse, { text }),
    importText: (projectId, text, mode) => invoke(IPC.input.importText, { projectId, text, mode }),
    listItems: (projectId) => invoke(IPC.input.listItems, { projectId }),
    reorder: (projectId, itemIds) => invoke(IPC.input.reorder, { projectId, itemIds }),
    removeItems: (ids) => invoke(IPC.input.removeItems, { ids })
  },
  cookies: {
    status: () => invoke(IPC.cookies.status),
    saveText: (text) => invoke(IPC.cookies.saveText, { text }),
    useBrowser: (browser, profile = '') => invoke(IPC.cookies.useBrowser, { browser, profile }),
    useFile: (path) => invoke(IPC.cookies.useFile, { path }),
    clear: () => invoke(IPC.cookies.clear)
  },
  dialogs: {
    chooseFolder: (defaultPath) => invoke(IPC.dialogs.chooseFolder, defaultPath ? { defaultPath } : {}),
    chooseTextFile: () => invoke(IPC.dialogs.chooseTextFile),
    chooseCookiesFile: () => invoke(IPC.dialogs.chooseCookiesFile),
    chooseBackupFile: () => invoke(IPC.dialogs.chooseBackupFile),
    saveTextFile: (input) => invoke(IPC.dialogs.saveTextFile, input)
  },
  settings: {
    get: () => invoke(IPC.settings.get),
    update: (patch) => invoke(IPC.settings.update, patch),
    hardware: () => invoke(IPC.settings.hardware),
    profiles: () => invoke(IPC.settings.profiles),
    saveResourceProfile: (profile) => invoke(IPC.settings.saveResourceProfile, profile),
    saveQualityProfile: (profile) => invoke(IPC.settings.saveQualityProfile, profile),
    recommend: () => invoke(IPC.settings.recommend)
  },
  queue: {
    list: () => invoke(IPC.queue.list),
    enqueueProject: (projectId) => invoke(IPC.queue.enqueueProject, { projectId }),
    pauseAll: () => invoke(IPC.queue.pauseAll),
    resumeAll: () => invoke(IPC.queue.resumeAll),
    pause: (jobId) => invoke(IPC.queue.pause, { jobId }),
    resume: (jobId) => invoke(IPC.queue.resume, { jobId }),
    cancel: (jobId) => invoke(IPC.queue.cancel, { jobId }),
    retry: (jobId) => invoke(IPC.queue.retry, { jobId }),
    retryFailed: (projectId) => invoke(IPC.queue.retryFailed, projectId ? { projectId } : {}),
    remove: (jobId, deleteOutput = false) => invoke(IPC.queue.remove, { jobId, deleteOutput }),
    clearFinished: (projectId) => invoke(IPC.queue.clearFinished, projectId ? { projectId } : {})
  },
  tools: {
    list: () => invoke(IPC.tools.list),
    healthCheck: () => invoke(IPC.tools.healthCheck),
    checkUpdates: () => invoke(IPC.tools.checkUpdates),
    update: (name) => invoke(IPC.tools.update, { name }),
    updateAll: () => invoke(IPC.tools.updateAll),
    repairAll: () => invoke(IPC.tools.repairAll),
    rollback: (name) => invoke(IPC.tools.rollback, { name }),
    openFolder: () => invoke(IPC.tools.openFolder)
  },
  media: {
    analyze: (path) => invoke(IPC.media.analyze, { path }),
    verifyFile: (path, level) => invoke(IPC.media.verifyFile, { path, level }),
    mergeProject: (projectId) => invoke(IPC.media.mergeProject, { projectId })
  },
  logs: {
    list: (query) => invoke(IPC.logs.list, { limit: 500, ...query }),
    exportDiagnostics: () => invoke(IPC.logs.exportDiagnostics),
    openFolder: () => invoke(IPC.logs.openFolder),
    clear: (projectId) => invoke(IPC.logs.clear, projectId ? { projectId } : {})
  },
  backups: {
    create: (projectId, includeMedia = false) => invoke(IPC.backups.create, { projectId, includeMedia }),
    preview: (path) => invoke(IPC.backups.preview, { path }),
    restore: (path, mode) => invoke(IPC.backups.restore, { path, mode })
  },
  systemCleanup: {
    start: (input) => invoke(IPC.systemCleanup.start, input),
    status: (runId) => invoke(IPC.systemCleanup.status, { runId }),
    cancel: (runId) => invoke(IPC.systemCleanup.cancel, { runId })
  },
  quickDownload: {
    defaults: () => invoke(IPC.quickDownload.defaults),
    current: () => invoke(IPC.quickDownload.current),
    chooseDirectory: (currentDirectory) =>
      invoke(IPC.quickDownload.chooseDirectory, currentDirectory ? { defaultPath: currentDirectory } : {}),
    start: (input) => invoke(IPC.quickDownload.start, input),
    status: (taskId) => invoke(IPC.quickDownload.status, { taskId }),
    pause: (taskId) => invoke(IPC.quickDownload.pause, { taskId }),
    resume: (taskId) => invoke(IPC.quickDownload.resume, { taskId }),
    cancel: (taskId) => invoke(IPC.quickDownload.cancel, { taskId }),
    revealOutput: (taskId) => invoke(IPC.quickDownload.revealOutput, { taskId })
  },
  updates: {
    status: () => invoke(IPC.updates.status),
    check: () => invoke(IPC.updates.check),
    download: () => invoke(IPC.updates.download),
    install: () => invoke(IPC.updates.install)
  },
  events: {
    onQueueChanged: (listener) => on(IPC.events.queueChanged, listener),
    onJobProgress: (listener) => on(IPC.events.jobProgress, listener),
    onLog: (listener) => on(IPC.events.log, listener),
    onSystemStats: (listener) => on(IPC.events.systemStats, listener),
    onUpdateStatus: (listener) => on(IPC.events.updateStatus, listener),
    onAttention: (listener) => on(IPC.events.attention, listener),
    onToolsChanged: (listener) => on(IPC.events.toolsChanged, listener)
  }
};
contextBridge.exposeInMainWorld('desktop', api);
