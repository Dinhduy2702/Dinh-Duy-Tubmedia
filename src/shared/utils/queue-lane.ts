import type { AppSettings, QueueJob, ResourceProfile } from '../types/domain.js';

export type QueueExecutionLane = 'download-list' | 'merge-workflow' | 'processing';

type LaneJob = Pick<QueueJob, 'type' | 'input'>;

export function queueExecutionLane(job: LaneJob): QueueExecutionLane {
  if (job.type === 'download') {
    return job.input.workflow === 'download-merge' ? 'merge-workflow' : 'download-list';
  }
  if (job.type === 'clip' || job.type === 'normalize' || job.type === 'merge') {
    return 'merge-workflow';
  }
  return 'processing';
}

export function independentDownloadProjectCanStart(
  activeInProject: number,
  profile: Pick<ResourceProfile, 'downloadWorkers'>
): boolean {
  const projectLimit = Math.max(1, Math.min(16, Math.round(profile.downloadWorkers || 1)));
  return Math.max(0, activeInProject) < projectLimit;
}

export function mergeSourceDownloadLimit(
  settings: Pick<AppSettings, 'maxGlobalMergeJobs'>,
  profile: Pick<ResourceProfile, 'downloadWorkers'>
): number {
  return Math.max(1, Math.min(16, settings.maxGlobalMergeJobs * Math.max(1, profile.downloadWorkers)));
}
