import { runInTransaction, type SqliteDatabase } from '../sqlite.js';
import { parseJsonOr } from '@shared/utils/safe-json.js';
import type { MediaInfo, MediaSource } from '@shared/types/domain.js';
import { sourceIdentityScope } from '@shared/utils/url.js';
interface Row {
  id: string;
  identity: string;
  original_url: string;
  normalized_url: string;
  platform: string;
  extractor_key: string;
  media_id: string;
  title: string | null;
  uploader: string | null;
  source_file: string | null;
  download_policy: string | null;
  verification_status: MediaSource['verificationStatus'];
  media_info_json: string | null;
  created_at: string;
  updated_at: string;
}
const map = (r: Row): MediaSource => ({
  id: r.id,
  identity: r.identity,
  originalUrl: r.original_url,
  normalizedUrl: r.normalized_url,
  platform: r.platform,
  extractorKey: r.extractor_key,
  mediaId: r.media_id,
  title: r.title,
  uploader: r.uploader,
  sourceFile: r.source_file,
  downloadPolicy: r.download_policy,
  verificationStatus: r.verification_status,
  mediaInfo: r.media_info_json ? parseJsonOr<MediaInfo | null>(r.media_info_json, null) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});
export class MediaSourceRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public get(id: string): MediaSource | null {
    const r = this.db.prepare('SELECT * FROM media_sources WHERE id=?').get(id) as Row | undefined;
    return r ? map(r) : null;
  }
  public byIdentity(identity: string): MediaSource | null {
    const r = this.db.prepare('SELECT * FROM media_sources WHERE identity=?').get(identity) as
      Row | undefined;
    return r ? map(r) : null;
  }
  public setFile(
    id: string,
    path: string,
    info: MediaInfo,
    status: MediaSource['verificationStatus'] = 'valid',
    downloadPolicy: string | null = null
  ): void {
    this.db
      .prepare(
        'UPDATE media_sources SET source_file=?,media_info_json=?,download_policy=?,verification_status=?,updated_at=? WHERE id=?'
      )
      .run(path, JSON.stringify(info), downloadPolicy, status, new Date().toISOString(), id);
  }
  public setMetadata(
    id: string,
    patch: { title?: string | null; uploader?: string | null; mediaId?: string; identity?: string }
  ): void {
    const current = this.get(id);
    if (!current) throw new Error('Source không tồn tại.');
    this.db
      .prepare('UPDATE media_sources SET title=?,uploader=?,media_id=?,identity=?,updated_at=? WHERE id=?')
      .run(
        patch.title === undefined ? current.title : patch.title,
        patch.uploader === undefined ? current.uploader : patch.uploader,
        patch.mediaId ?? current.mediaId,
        patch.identity ?? current.identity,
        new Date().toISOString(),
        id
      );
  }
  public clearCorruptedMetadata(): number {
    const replacement = '\uFFFD',
      now = new Date().toISOString();
    return Number(
      this.db
        .prepare(
          `UPDATE media_sources SET title=CASE WHEN instr(COALESCE(title,''),?)>0 THEN NULL ELSE title END,uploader=CASE WHEN instr(COALESCE(uploader,''),?)>0 THEN NULL ELSE uploader END,updated_at=? WHERE instr(COALESCE(title,''),?)>0 OR instr(COALESCE(uploader,''),?)>0`
        )
        .run(replacement, replacement, now, replacement, replacement).changes
    );
  }
  public promoteIdentity(id: string, mediaId: string): string {
    return runInTransaction(this.db, () => {
      const current = this.get(id);
      if (!current) throw new Error('Source không tồn tại.');
      const identity = `${current.platform}:${current.extractorKey}:${mediaId}${sourceIdentityScope(current.identity)}`;
      const existing = this.byIdentity(identity);
      const now = new Date().toISOString();
      if (existing && existing.id !== id) {
        if (!existing.sourceFile && current.sourceFile)
          this.db
            .prepare(
              'UPDATE media_sources SET source_file=?,media_info_json=?,download_policy=?,verification_status=?,title=COALESCE(title,?),uploader=COALESCE(uploader,?),updated_at=? WHERE id=?'
            )
            .run(
              current.sourceFile,
              current.mediaInfo ? JSON.stringify(current.mediaInfo) : null,
              current.downloadPolicy,
              current.verificationStatus,
              current.title,
              current.uploader,
              now,
              existing.id
            );
        this.db
          .prepare('UPDATE project_items SET source_id=?,media_id=?,updated_at=? WHERE source_id=?')
          .run(existing.id, mediaId, now, id);
        this.db
          .prepare('UPDATE queue_jobs SET source_id=?,updated_at=? WHERE source_id=?')
          .run(existing.id, now, id);
        this.db.prepare('DELETE FROM media_sources WHERE id=?').run(id);
        return existing.id;
      }
      this.db
        .prepare('UPDATE media_sources SET media_id=?,identity=?,updated_at=? WHERE id=?')
        .run(mediaId, identity, now, id);
      this.db
        .prepare('UPDATE project_items SET media_id=?,updated_at=? WHERE source_id=?')
        .run(mediaId, now, id);
      return id;
    });
  }
  public invalidate(id: string): void {
    this.db
      .prepare("UPDATE media_sources SET verification_status='invalid',updated_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
  }
  public clearFileCache(id: string): void {
    this.db
      .prepare(
        "UPDATE media_sources SET source_file=NULL,media_info_json=NULL,download_policy=NULL,verification_status='unknown',updated_at=? WHERE id=?"
      )
      .run(new Date().toISOString(), id);
  }
}
