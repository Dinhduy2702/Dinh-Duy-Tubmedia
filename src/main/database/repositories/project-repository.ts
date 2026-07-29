import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SqliteDatabase } from '../sqlite.js';
import type { Project, ProjectCreateInput } from '@shared/types/domain.js';

interface ProjectRow {
  id: string; name: string; code: string | null; description: string; status: Project['status'];
  source_folder: string; temp_folder: string; output_folder: string; quarantine_folder: string;
  final_file_name: string; quality_profile_id: string; resource_profile_id: string;
  export_timeline_txt: number;
  created_at: string; updated_at: string; archived_at: string | null;
}
function map(row: ProjectRow): Project {
  return { id: row.id, name: row.name, code: row.code, description: row.description, status: row.status,
    sourceFolder: row.source_folder, tempFolder: row.temp_folder, outputFolder: row.output_folder,
    quarantineFolder: row.quarantine_folder, finalFileName: row.final_file_name,
    qualityProfileId: row.quality_profile_id, resourceProfileId: row.resource_profile_id,
    exportTimelineTxt: row.export_timeline_txt === 1,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at };
}
export class ProjectRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public list(includeArchived = false): Project[] {
    const sql = includeArchived ? 'SELECT * FROM projects ORDER BY updated_at DESC' : "SELECT * FROM projects WHERE status <> 'archived' ORDER BY updated_at DESC";
    return (this.db.prepare(sql).all() as unknown as ProjectRow[]).map(map);
  }
  public get(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? map(row) : null;
  }
  public getByCode(code: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE code = ? ORDER BY updated_at DESC LIMIT 1').get(code) as ProjectRow | undefined;
    return row ? map(row) : null;
  }
  public listByCodes(codes: string[]): Project[] {
    const uniqueCodes = [...new Set(codes.filter((code) => code.length > 0))];
    if (uniqueCodes.length === 0) return [];
    const placeholders = uniqueCodes.map(() => '?').join(',');
    return (this.db
      .prepare(`SELECT * FROM projects WHERE code IN (${placeholders}) ORDER BY updated_at DESC`)
      .all(...uniqueCodes) as unknown as ProjectRow[]).map(map);
  }
  public create(input: ProjectCreateInput): Project {
    const now = new Date().toISOString();
    const id = randomUUID();
    const quarantineFolder = join(input.tempFolder, '_quarantine');
    this.db.prepare(`INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,export_timeline_txt,created_at,updated_at,archived_at)
      VALUES(@id,@name,@code,@description,'draft',@sourceFolder,@tempFolder,@outputFolder,@quarantineFolder,@finalFileName,@qualityProfileId,@resourceProfileId,@exportTimelineTxt,@now,@now,NULL)`).run({
      id, name: input.name, code: input.code ?? null, description: input.description ?? '', sourceFolder: input.sourceFolder,
      tempFolder: input.tempFolder, outputFolder: input.outputFolder, quarantineFolder, finalFileName: input.finalFileName,
      qualityProfileId: input.qualityProfileId, resourceProfileId: input.resourceProfileId,
      exportTimelineTxt: input.exportTimelineTxt === true ? 1 : 0, now
    });
    return this.get(id)!;
  }
  public update(id: string, patch: Partial<ProjectCreateInput>): Project {
    const current = this.get(id); if (!current) throw new Error('Dự án không tồn tại.');
    const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(`UPDATE projects SET name=?,code=?,description=?,source_folder=?,temp_folder=?,output_folder=?,quarantine_folder=?,final_file_name=?,quality_profile_id=?,resource_profile_id=?,export_timeline_txt=?,updated_at=? WHERE id=?`).run(
      merged.name, merged.code, merged.description, merged.sourceFolder, merged.tempFolder, merged.outputFolder,
      join(merged.tempFolder, '_quarantine'), merged.finalFileName, merged.qualityProfileId, merged.resourceProfileId,
      merged.exportTimelineTxt ? 1 : 0, merged.updatedAt, id
    );
    return this.get(id)!;
  }
  public setStatus(id: string, status: Project['status']): void {
    const archivedAt = status === 'archived' ? new Date().toISOString() : null;
    this.db.prepare('UPDATE projects SET status=?, archived_at=?, updated_at=? WHERE id=?').run(status, archivedAt, new Date().toISOString(), id);
  }
  public remove(id: string): void { this.db.prepare('DELETE FROM projects WHERE id=?').run(id); }
  public removeAll(): number {
    return Number(this.db.prepare('DELETE FROM projects').run().changes);
  }
  public duplicate(id: string): Project {
    const source = this.get(id); if (!source) throw new Error('Dự án không tồn tại.');
    const copy = this.create({ ...source, name: `${source.name} - Bản sao`, code: source.code ? `${source.code}-COPY` : null });
    this.db.prepare(`INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at)
      SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random()) % 4 + 1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))), ?, NULL, position, original_text,url,normalized_url,platform,extractor_key,media_id,NULL,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,NULL,enabled,?,? FROM project_items WHERE project_id=?`).run(copy.id, new Date().toISOString(), new Date().toISOString(), id);
    return copy;
  }
}
