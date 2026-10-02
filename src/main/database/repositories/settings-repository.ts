import { randomUUID } from 'node:crypto';
import { parseJsonOr } from '@shared/utils/safe-json.js';
import type { SqliteDatabase } from '../sqlite.js';
import type { AppSettings, QualityProfile, ResourceProfile } from '@shared/types/domain.js';

/** Cài đặt thêm từ 1.5.1, lưu ở dòng riêng để khối 'app' vẫn khớp schema của 1.5.0. */
const EXTRA_SETTINGS_ROW = 'app_extra';
const EXTRA_SETTING_KEYS = ['autoResumeInterruptedOnStartup'] as const satisfies ReadonlyArray<keyof AppSettings>;

export class SettingsRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key) as { value_json: string } | undefined;
    return row ? parseJsonOr<T>(row.value_json, fallback) : fallback;
  }
  public set<T>(key: string, value: T): void {
    const old = this.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key) as { value_json: string } | undefined;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(key, JSON.stringify(value), now);
    this.db.prepare('INSERT INTO setting_change_history(id,scope,scope_id,key,old_value_json,new_value_json,changed_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'global', null, key, old?.value_json ?? null, JSON.stringify(value), now);
  }
  public getAppSettings(defaults: AppSettings): AppSettings {
    return { ...defaults, ...this.get<Partial<AppSettings>>('app', {}), ...this.get<Partial<AppSettings>>(EXTRA_SETTINGS_ROW, {}) };
  }
  public saveAppSettings(settings: AppSettings): void {
    // Khóa mới từ 1.5.1 lưu NGOÀI khối 'app': bản 1.5.0 kiểm cài đặt bằng schema .strict(), một khóa lạ trong
    // 'app' làm 1.5.0 không lưu được cài đặt nữa nếu người dùng quay lui (Đợt 1, 2026-10-02).
    const base: Record<string, unknown> = { ...settings };
    const extra: Record<string, unknown> = {};
    for (const key of EXTRA_SETTING_KEYS) {
      extra[key] = settings[key];
      delete base[key];
    }
    this.set('app', base);
    if (JSON.stringify(this.get<Record<string, unknown>>(EXTRA_SETTINGS_ROW, {})) !== JSON.stringify(extra)) {
      this.set(EXTRA_SETTINGS_ROW, extra);
    }
  }
  public listResourceProfiles(): ResourceProfile[] {
    return (this.db.prepare('SELECT profile_json FROM resource_profiles ORDER BY built_in DESC,name').all() as Array<{ profile_json: string }>)
      .map((row) => parseJsonOr<ResourceProfile | null>(row.profile_json, null))
      .filter((profile): profile is ResourceProfile => profile !== null);
  }
  public saveResourceProfile(profile: ResourceProfile): void {
    this.db.prepare(`INSERT INTO resource_profiles(id,name,description,profile_json,built_in,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,profile_json=excluded.profile_json,built_in=excluded.built_in,updated_at=excluded.updated_at`).run(profile.id, profile.name, profile.description, JSON.stringify(profile), profile.builtIn ? 1 : 0, new Date().toISOString());
  }
  public listQualityProfiles(): QualityProfile[] {
    return (this.db.prepare('SELECT profile_json FROM quality_profiles ORDER BY built_in DESC,name').all() as Array<{ profile_json: string }>)
      .map((row) => parseJsonOr<QualityProfile | null>(row.profile_json, null))
      .filter((profile): profile is QualityProfile => profile !== null);
  }
  public saveQualityProfile(profile: QualityProfile): void {
    this.db.prepare(`INSERT INTO quality_profiles(id,name,description,profile_json,built_in,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,profile_json=excluded.profile_json,built_in=excluded.built_in,updated_at=excluded.updated_at`).run(profile.id, profile.name, profile.description, JSON.stringify(profile), profile.builtIn ? 1 : 0, new Date().toISOString());
  }
}
