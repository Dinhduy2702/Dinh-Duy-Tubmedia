export interface Migration { version: number; name: string; up: string; }
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  source_folder TEXT NOT NULL,
  temp_folder TEXT NOT NULL,
  output_folder TEXT NOT NULL,
  quarantine_folder TEXT NOT NULL,
  final_file_name TEXT NOT NULL,
  quality_profile_id TEXT NOT NULL,
  resource_profile_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resource_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quality_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS input_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  source TEXT NOT NULL,
  original_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS project_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  batch_id TEXT,
  position INTEGER NOT NULL,
  original_text TEXT NOT NULL,
  url TEXT,
  normalized_url TEXT,
  platform TEXT,
  extractor_key TEXT,
  media_id TEXT,
  source_id TEXT,
  timestamp_start REAL,
  timestamp_end REAL,
  note TEXT NOT NULL,
  audio_mode TEXT NOT NULL,
  validity TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  errors_json TEXT NOT NULL,
  clip_file TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(batch_id) REFERENCES input_batches(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_project_items_project_position ON project_items(project_id, position);
CREATE INDEX IF NOT EXISTS idx_project_items_source ON project_items(source_id);
CREATE TABLE IF NOT EXISTS media_sources (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  extractor_key TEXT NOT NULL,
  media_id TEXT NOT NULL,
  title TEXT,
  uploader TEXT,
  source_file TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unknown',
  media_info_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_sources_platform_id ON media_sources(platform, extractor_key, media_id);
CREATE TABLE IF NOT EXISTS source_files (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unknown',
  reference_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES media_sources(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS queue_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  source_id TEXT,
  item_id TEXT,
  input_json TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  speed TEXT,
  eta_seconds INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES media_sources(id) ON DELETE SET NULL,
  FOREIGN KEY(item_id) REFERENCES project_items(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_status_priority ON queue_jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_queue_project ON queue_jobs(project_id, status);
CREATE TABLE IF NOT EXISTS process_jobs (
  id TEXT PRIMARY KEY,
  queue_job_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  pid INTEGER NOT NULL,
  priority TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  FOREIGN KEY(queue_job_id) REFERENCES queue_jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS download_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  error_class TEXT,
  stderr_tail TEXT,
  FOREIGN KEY(job_id) REFERENCES queue_jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS output_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_id TEXT,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration REAL,
  media_info_json TEXT,
  verification_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES queue_jobs(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tool_installations (
  name TEXT PRIMARY KEY,
  executable_path TEXT,
  version TEXT,
  source TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  health TEXT NOT NULL DEFAULT 'broken',
  error TEXT,
  last_checked_at TEXT,
  pinned_version TEXT,
  skipped_version TEXT
);
CREATE TABLE IF NOT EXISTS tool_update_history (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  from_version TEXT,
  to_version TEXT,
  status TEXT NOT NULL,
  backup_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_update_history (
  id TEXT PRIMARY KEY,
  from_version TEXT,
  to_version TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  module TEXT NOT NULL,
  project_id TEXT,
  job_id TEXT,
  attempt_id TEXT,
  event_code TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON event_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_project_job ON event_logs(project_id, job_id, timestamp DESC);
CREATE TABLE IF NOT EXISTS hardware_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  detected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_history (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  path TEXT NOT NULL,
  include_media INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
`
  },
  {
    version: 2,
    name: 'source_lock_and_setting_history',
    up: `
CREATE TABLE IF NOT EXISTS resource_locks (
  resource_key TEXT PRIMARY KEY,
  owner_job_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS setting_change_history (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT,
  key TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
`
  },
  {
    version: 3,
    name: 'optional_timeline_txt_export',
    up: `
ALTER TABLE projects ADD COLUMN export_timeline_txt INTEGER NOT NULL DEFAULT 0;
`
  },
  {
    version: 4,
    name: 'source_download_quality_policy',
    up: `
ALTER TABLE media_sources ADD COLUMN download_policy TEXT;
`
  },
  {
    version: 5,
    name: 'isolate_sources_by_project',
    up: `
CREATE TEMP TABLE source_project_scope_map (
  project_id TEXT NOT NULL,
  old_source_id TEXT NOT NULL,
  new_source_id TEXT NOT NULL,
  PRIMARY KEY(project_id, old_source_id)
);
INSERT INTO source_project_scope_map(project_id, old_source_id, new_source_id)
SELECT scoped.project_id, scoped.source_id, lower(hex(randomblob(16)))
FROM (
  SELECT project_id, source_id
  FROM project_items
  WHERE source_id IS NOT NULL
  UNION
  SELECT project_id, source_id
  FROM queue_jobs
  WHERE project_id IS NOT NULL AND source_id IS NOT NULL
) AS scoped
JOIN media_sources ON media_sources.id=scoped.source_id
WHERE instr(media_sources.identity, '::project:')=0;

INSERT INTO media_sources(
  id, identity, original_url, normalized_url, platform, extractor_key, media_id,
  title, uploader, source_file, download_policy, verification_status,
  media_info_json, created_at, updated_at
)
SELECT
  mapping.new_source_id,
  source.identity || '::project:' || mapping.project_id,
  source.original_url,
  source.normalized_url,
  source.platform,
  source.extractor_key,
  source.media_id,
  source.title,
  source.uploader,
  NULL,
  NULL,
  'unknown',
  NULL,
  source.created_at,
  datetime('now')
FROM source_project_scope_map AS mapping
JOIN media_sources AS source ON source.id=mapping.old_source_id;

UPDATE project_items
SET source_id=(
  SELECT mapping.new_source_id
  FROM source_project_scope_map AS mapping
  WHERE mapping.project_id=project_items.project_id
    AND mapping.old_source_id=project_items.source_id
)
WHERE EXISTS (
  SELECT 1
  FROM source_project_scope_map AS mapping
  WHERE mapping.project_id=project_items.project_id
    AND mapping.old_source_id=project_items.source_id
);

UPDATE queue_jobs
SET source_id=(
  SELECT mapping.new_source_id
  FROM source_project_scope_map AS mapping
  WHERE mapping.project_id=queue_jobs.project_id
    AND mapping.old_source_id=queue_jobs.source_id
)
WHERE EXISTS (
  SELECT 1
  FROM source_project_scope_map AS mapping
  WHERE mapping.project_id=queue_jobs.project_id
    AND mapping.old_source_id=queue_jobs.source_id
);

DELETE FROM media_sources
WHERE instr(identity, '::project:')=0
  AND NOT EXISTS (SELECT 1 FROM project_items WHERE project_items.source_id=media_sources.id)
  AND NOT EXISTS (SELECT 1 FROM queue_jobs WHERE queue_jobs.source_id=media_sources.id);
DROP TABLE source_project_scope_map;
`
  },
  {
    version: 6,
    name: 'move_quarantine_to_temp_storage',
    up: `
UPDATE projects
SET quarantine_folder = rtrim(temp_folder, '\\/') || '\\_quarantine';
`
  }
];
