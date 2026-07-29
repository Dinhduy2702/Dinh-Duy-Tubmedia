import { z } from 'zod';

export const idSchema = z.string().uuid();
export const pathSchema = z.string().trim().min(1).max(32_768);
export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(4000).optional(),
  sourceFolder: pathSchema,
  tempFolder: pathSchema,
  outputFolder: pathSchema,
  finalFileName: z.string().trim().min(1).max(220),
  qualityProfileId: z.string().min(1),
  resourceProfileId: z.string().min(1),
  exportTimelineTxt: z.boolean().optional()
});
export const projectUpdateSchema = projectCreateSchema.partial().extend({ id: idSchema });
export const parseInputSchema = z.object({ text: z.string().max(10_000_000) });
export const importInputSchema = z.object({
  projectId: idSchema,
  text: z.string().max(10_000_000),
  mode: z.enum(['append', 'replace'])
});
export const reorderSchema = z.object({ projectId: idSchema, itemIds: z.array(idSchema).max(50_000) });
export const idsSchema = z.object({ ids: z.array(idSchema).max(50_000) });
export const projectIdSchema = z.object({ projectId: idSchema });
export const jobIdSchema = z.object({ jobId: idSchema });
export const queueRemoveSchema = z.object({ jobId: idSchema, deleteOutput: z.boolean().default(false) });
const processPrioritySchema = z.enum(['idle', 'below_normal', 'normal', 'above_normal', 'high']);
export const appSettingsSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    language: z.literal('vi'),
    minimizeToTray: z.boolean(),
    startWithWindows: z.boolean(),
    closeBehavior: z.enum(['ask', 'pause_and_exit', 'cancel_and_exit', 'tray']),
    defaultSourceFolder: pathSchema,
    defaultTempFolder: pathSchema,
    defaultOutputFolder: pathSchema,
    defaultQualityProfileId: z.string().min(1).max(160),
    defaultResourceProfileId: z.string().min(1).max(160),
    verificationLevel: z.enum(['fast', 'standard', 'deep']),
    sourceCachePolicy: z.enum(['forever', 'days', 'project_complete', 'manual']),
    sourceCacheDays: z.number().int().min(1).max(3650),
    logRetentionDays: z.number().int().min(1).max(3650),
    appUpdateChannel: z.enum(['stable', 'beta']),
    toolUpdateChannel: z.enum(['stable', 'beta']),
    autoCheckAppUpdates: z.boolean(),
    autoCheckToolUpdates: z.boolean(),
    toolManifestUrl: z.union([z.literal(''), z.url()]),
    appFeedUrl: z.union([z.literal(''), z.url()]),
    ytdlpPath: z.string().max(32_768),
    ffmpegPath: z.string().max(32_768),
    ffprobePath: z.string().max(32_768),
    aria2cPath: z.string().max(32_768),
    cookiesFilePath: z.string().max(32_768),
    cookiesBrowser: z.enum(['none', 'chrome', 'edge', 'firefox']),
    cookiesBrowserProfile: z.string().max(512),
    proxy: z.string().max(2048),
    rateLimit: z.string().max(100),
    useAria2c: z.boolean(),
    aria2Connections: z.number().int().min(1).max(32),
    maxGlobalDownloadWorkers: z.number().int().min(1).max(16),
    downloadConcurrentFragments: z.number().int().min(1).max(8),
    downloadLaneCount: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    mergeLaneCount: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    maxGlobalMergeJobs: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    downloadCompatibilityMode: z.enum(['source', 'capcut_sdr_1080p', 'capcut_sdr_2k']),
    downloadMinHeight: z.number().int().min(0).max(4320),
    downloadMaxHeight: z.number().int().min(0).max(4320),
    downloadMinFps: z.number().min(0).max(240),
    downloadMaxFps: z.number().min(0).max(240),
    downloadCodecPreference: z.enum(['auto', 'h264', 'hevc', 'vp9', 'av1']),
    downloadContainerPreference: z.enum(['auto', 'mp4', 'mkv']),
    downloadMinVideoBitrateKbps: z.number().int().min(0).max(200000),
    downloadVideoBitrateKbps: z.number().int().min(0).max(200000),
    downloadMinAudioBitrateKbps: z.number().int().min(0).max(512),
    downloadAudioBitrateKbps: z.number().int().min(0).max(512),
    downloadAllowBelowMinimum: z.boolean(),
    downloadVerifyEntireFile: z.boolean(),
    progressRefreshMs: z.number().int().min(100).max(5000)
  })
  .strict();
export const settingsPatchSchema = appSettingsSchema.partial();
export const resourceProfileSchema = z
  .object({
    id: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    description: z.string().max(1000),
    downloadWorkers: z.number().int().min(1).max(16),
    analyzeWorkers: z.number().int().min(1).max(16),
    normalizeWorkers: z.number().int().min(1).max(4),
    remuxWorkers: z.number().int().min(1).max(8),
    clipWorkers: z.number().int().min(1).max(8),
    ffmpegThreads: z.number().int().min(1).max(128),
    filterThreads: z.number().int().min(1).max(64),
    filterComplexThreads: z.number().int().min(1).max(64),
    processPriority: processPrioritySchema,
    cpuSoftLimitPercent: z.number().min(20).max(100),
    memoryFreeMinimumBytes: z.number().int().nonnegative(),
    diskFreeMinimumBytes: z.number().int().nonnegative(),
    gpuJobs: z.number().int().min(0).max(4),
    builtIn: z.boolean()
  })
  .strict();
export const qualityProfileSchema = z
  .object({
    id: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    description: z.string().max(1000),
    mode: z.enum([
      'highest_source',
      'smart_merge',
      'compatible_1080p',
      'smooth_background',
      'maximum_cpu',
      'custom'
    ]),
    maxWidth: z.number().int().positive().nullable(),
    maxHeight: z.number().int().positive().nullable(),
    allowUpscale: z.boolean(),
    fpsMode: z.enum(['source', '30', '60', 'custom']),
    customFps: z.number().positive().max(240).nullable(),
    videoCodec: z.enum(['copy', 'h264', 'hevc']),
    encoder: z.enum(['cpu_auto', 'auto', 'libx264', 'h264_nvenc', 'hevc_nvenc']),
    crf: z.number().int().min(0).max(51),
    cq: z.number().int().min(0).max(51),
    preset: z.string().min(1).max(100),
    bitrateMode: z.enum(['quality', 'source_average']).optional(),
    pixelFormat: z.string().min(1).max(100),
    hdrMode: z.enum(['keep', 'tonemap_sdr', 'auto', 'forbid']),
    audioMode: z.enum(['copy_if_compatible', 'aac_256', 'aac_320', 'mute', 'silent']),
    sampleRate: z.number().int().min(8000).max(192000),
    forceStereo: z.boolean(),
    builtIn: z.boolean()
  })
  .strict();
export const logQuerySchema = z.object({
  projectId: idSchema.optional(),
  jobId: idSchema.optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  module: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(5000).default(500)
});
export const showPathSchema = z.object({ path: pathSchema });
export const chooseFolderSchema = z.object({ defaultPath: pathSchema.optional() });
export const verifyFileSchema = z.object({ path: pathSchema, level: z.enum(['fast', 'standard', 'deep']) });
export const backupCreateSchema = z.object({
  projectId: idSchema.optional(),
  includeMedia: z.boolean().default(false)
});
export const backupRestoreSchema = z.object({ path: pathSchema, mode: z.enum(['merge', 'replace']) });
export const toolNameSchema = z.object({ name: z.enum(['yt-dlp', 'ffmpeg', 'ffprobe', 'ffplay', 'aria2c']) });

const downloadLaneIdSchema = z.enum(['download-1', 'download-2', 'download-3', 'download-4']);
const mergeLaneIdSchema = z.enum(['merge-1', 'merge-2', 'merge-3', 'merge-4']);
export const workbenchSlotSchema = z.object({
  slot: z.union([downloadLaneIdSchema, mergeLaneIdSchema])
});
export const downloadLaneSchema = z.object({
  slot: downloadLaneIdSchema,
  name: z.string().trim().min(1).max(160),
  linksText: z.string().min(1).max(10_000_000),
  outputFolder: pathSchema,
  tempFolder: pathSchema,
  resourceProfileId: z.string().min(1).max(160)
});
export const downloadLaneDraftSchema = z.object({
  slot: downloadLaneIdSchema,
  name: z.string().trim().max(160),
  linksText: z.string().max(10_000_000),
  outputFolder: z.string().max(32_768),
  tempFolder: z.string().max(32_768),
  resourceProfileId: z.string().max(160),
  downloadWorkers: z.number().int().min(1).max(16)
});
export const downloadMergeDraftSchema = z.object({
  slot: mergeLaneIdSchema,
  name: z.string().trim().max(160),
  linksText: z.string().max(10_000_000),
  sourceFolder: z.string().max(32_768),
  tempFolder: z.string().max(32_768),
  outputFolder: z.string().max(32_768),
  finalFileName: z.string().trim().max(220),
  qualityProfileId: z.string().max(160),
  resourceProfileId: z.string().max(160),
  exportTimelineTxt: z.boolean()
});
export const downloadMergeSchema = z.object({
  slot: mergeLaneIdSchema,
  name: z.string().trim().min(1).max(160),
  linksText: z.string().min(1).max(10_000_000),
  sourceFolder: pathSchema,
  tempFolder: pathSchema,
  outputFolder: pathSchema,
  finalFileName: z.string().trim().min(1).max(220),
  qualityProfileId: z.string().min(1).max(160),
  resourceProfileId: z.string().min(1).max(160),
  exportTimelineTxt: z.boolean()
});

export const cookieTextSchema = z.object({ text: z.string().min(1).max(20_000_000) });
export const clipboardTextSchema = z.object({ text: z.string().max(20_000_000) });
export const saveTextFileSchema = z.object({
  defaultName: z.string().trim().min(1).max(220),
  content: z.string().max(20_000_000),
  defaultFolder: z.string().max(32_768).optional()
});
export const browserCookieSchema = z.object({
  browser: z.enum(['chrome', 'edge', 'firefox']),
  profile: z.string().max(512).default('')
});
export const clearWorkbenchSchema = z.object({ slot: z.union([downloadLaneIdSchema, mergeLaneIdSchema]) });
export const clearLogsSchema = z.object({ projectId: idSchema.optional() });

// TUBMEDIA_FEATURE_IPC_SCHEMAS
export const systemCleanupCategorySchema = z.enum([
  'userTemp',
  'thumbnailCache',
  'crashReports',
  'browserCache',
  'capcutCache',
  'zaloCache',
  'recycleBin',
  'windowsTemp',
  'windowsUpdate',
  'deliveryOptimization',
  'componentStore',
  'disableHibernate'
]);
export const systemCleanupRequestSchema = z
  .object({
    mode: z.enum(['estimate', 'clean']),
    categories: z.array(systemCleanupCategorySchema).min(1).max(12)
  })
  .strict();
export const systemCleanupRunSchema = z
  .object({
    runId: idSchema
  })
  .strict();

export const quickDownloadRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(4096),
    outputDirectory: pathSchema,
    quality: z.enum(['best', '1080p', '720p', '480p']),
    mode: z.enum(['full', 'range']),
    startTime: z.string().trim().max(32).optional(),
    endTime: z.string().trim().max(32).optional(),
    accurateCut: z.boolean().default(false)
  })
  .strict();
export const quickDownloadTaskSchema = z
  .object({
    taskId: idSchema
  })
  .strict();
