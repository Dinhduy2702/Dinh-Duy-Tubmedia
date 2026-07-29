export const IPC = {
  app: {
    getBootstrap: 'app:get-bootstrap',
    getSystemStats: 'app:get-system-stats',
    showPath: 'app:show-path',
    readClipboard: 'app:read-clipboard',
    writeClipboard: 'app:write-clipboard'
  },
  workbench: {
    state: 'workbench:state',
    startDownload: 'workbench:start-download',
    startMerge: 'workbench:start-merge',
    saveDownloadDraft: 'workbench:save-download-draft',
    saveMergeDraft: 'workbench:save-merge-draft',
    storage: 'workbench:storage',
    pause: 'workbench:pause',
    resume: 'workbench:resume',
    cancel: 'workbench:cancel',
    clearProgress: 'workbench:clear-progress',
    clearLogs: 'workbench:clear-logs',
    remove: 'workbench:remove',
    removeAll: 'workbench:remove-all'
  },
  projects: {
    list: 'projects:list',
    get: 'projects:get',
    create: 'projects:create',
    update: 'projects:update',
    archive: 'projects:archive',
    restore: 'projects:restore',
    remove: 'projects:remove',
    duplicate: 'projects:duplicate'
  },
  input: {
    parse: 'input:parse',
    importText: 'input:import-text',
    listItems: 'input:list-items',
    reorder: 'input:reorder',
    removeItems: 'input:remove-items'
  },
  cookies: {
    status: 'cookies:status',
    saveText: 'cookies:save-text',
    useBrowser: 'cookies:use-browser',
    useFile: 'cookies:use-file',
    clear: 'cookies:clear'
  },
  dialogs: {
    chooseFolder: 'dialogs:choose-folder',
    chooseTextFile: 'dialogs:choose-text-file',
    chooseCookiesFile: 'dialogs:choose-cookies-file',
    chooseBackupFile: 'dialogs:choose-backup-file',
    saveTextFile: 'dialogs:save-text-file'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    hardware: 'settings:hardware',
    profiles: 'settings:profiles',
    saveResourceProfile: 'settings:save-resource-profile',
    saveQualityProfile: 'settings:save-quality-profile',
    recommend: 'settings:recommend'
  },
  queue: {
    list: 'queue:list',
    enqueueProject: 'queue:enqueue-project',
    pauseAll: 'queue:pause-all',
    resumeAll: 'queue:resume-all',
    pause: 'queue:pause',
    resume: 'queue:resume',
    cancel: 'queue:cancel',
    retry: 'queue:retry',
    retryFailed: 'queue:retry-failed',
    remove: 'queue:remove',
    clearFinished: 'queue:clear-finished'
  },
  tools: {
    list: 'tools:list',
    healthCheck: 'tools:health-check',
    checkUpdates: 'tools:check-updates',
    update: 'tools:update',
    updateAll: 'tools:update-all',
    repairAll: 'tools:repair-all',
    rollback: 'tools:rollback',
    openFolder: 'tools:open-folder'
  },
  media: {
    analyze: 'media:analyze',
    mergeProject: 'media:merge-project',
    verifyFile: 'media:verify-file'
  },
  logs: {
    list: 'logs:list',
    exportDiagnostics: 'logs:export-diagnostics',
    openFolder: 'logs:open-folder',
    clear: 'logs:clear'
  },
  backups: {
    create: 'backups:create',
    restore: 'backups:restore',
    preview: 'backups:preview'
  },
  systemCleanup: {
    start: 'system-cleanup:start',
    status: 'system-cleanup:status',
    cancel: 'system-cleanup:cancel'
  },
  quickDownload: {
    defaults: 'quick-download:defaults',
    chooseDirectory: 'quick-download:choose-directory',
    start: 'quick-download:start',
    status: 'quick-download:status',
    cancel: 'quick-download:cancel',
    revealOutput: 'quick-download:reveal-output'
  },
  updates: {
    status: 'updates:status',
    check: 'updates:check',
    download: 'updates:download',
    install: 'updates:install'
  },
  events: {
    queueChanged: 'events:queue-changed',
    jobProgress: 'events:job-progress',
    log: 'events:log',
    systemStats: 'events:system-stats',
    updateStatus: 'events:update-status',
    attention: 'events:attention',
    toolsChanged: 'events:tools-changed'
  }
} as const;
