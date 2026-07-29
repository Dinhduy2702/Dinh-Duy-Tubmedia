import { randomUUID } from 'node:crypto';
import { runInTransaction, type SqliteDatabase } from '../sqlite.js';
import { parseJsonStringArray } from '@shared/utils/safe-json.js';
import type { ParsedInputLine, ProjectItem } from '@shared/types/domain.js';
import { scopedSourceIdentity, sourceIdentity } from '@shared/utils/url.js';

interface Row {
  id:string;project_id:string;position:number;original_text:string;url:string|null;normalized_url:string|null;platform:string|null;extractor_key:string|null;media_id:string|null;source_id:string|null;timestamp_start:number|null;timestamp_end:number|null;note:string;audio_mode:ProjectItem['audioMode'];validity:ProjectItem['validity'];warnings_json:string;errors_json:string;clip_file:string|null;enabled:number;created_at:string;updated_at:string;
}
function map(r:Row):ProjectItem{return{id:r.id,projectId:r.project_id,position:r.position,originalText:r.original_text,url:r.url,normalizedUrl:r.normalized_url,platform:r.platform,extractorKey:r.extractor_key,mediaId:r.media_id,sourceId:r.source_id,timestampStartSeconds:r.timestamp_start,timestampEndSeconds:r.timestamp_end,note:r.note,audioMode:r.audio_mode,validity:r.validity,warnings:parseJsonStringArray(r.warnings_json),errors:parseJsonStringArray(r.errors_json),clipFile:r.clip_file,enabled:Boolean(r.enabled),createdAt:r.created_at,updatedAt:r.updated_at,lineNumber:r.position};}
export class ItemRepository {
  public constructor(private readonly db:SqliteDatabase){}
  public list(projectId:string):ProjectItem[]{return(this.db.prepare('SELECT * FROM project_items WHERE project_id=? ORDER BY position').all(projectId) as unknown as Row[]).map(map);}
  public import(projectId:string,lines:ParsedInputLine[],mode:'append'|'replace'):ProjectItem[]{
    runInTransaction(this.db,()=>{
      if(mode==='replace'){this.db.prepare('DELETE FROM project_items WHERE project_id=?').run(projectId);this.db.prepare('DELETE FROM input_batches WHERE project_id=?').run(projectId);}
      const start=Number((this.db.prepare('SELECT COALESCE(MAX(position),0) max FROM project_items WHERE project_id=?').get(projectId) as {max:number}).max);
      const batchId=randomUUID(),now=new Date().toISOString();
      this.db.prepare('INSERT INTO input_batches(id,project_id,mode,source,original_text,created_at) VALUES(?,?,?,?,?,?)').run(batchId,projectId,mode,'text',lines.map(l=>l.originalText).join('\n'),now);
      const insert=this.db.prepare(`INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at) VALUES(@id,@projectId,@batchId,@position,@originalText,@url,@normalizedUrl,@platform,@extractorKey,@mediaId,@sourceId,@timestampStart,@timestampEnd,@note,@audioMode,@validity,@warnings,@errors,NULL,1,@now,@now)`);
      lines.forEach((line,i)=>{let sourceId:string|null=null;if(line.normalizedUrl&&line.platform&&line.extractorKey){const baseIdentity=sourceIdentity(line.platform,line.extractorKey,line.mediaId,line.normalizedUrl);const identity=scopedSourceIdentity(baseIdentity,projectId);const existing=this.db.prepare('SELECT id FROM media_sources WHERE identity=?').get(identity) as {id:string}|undefined;sourceId=existing?.id??randomUUID();if(!existing)this.db.prepare(`INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,verification_status,media_info_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,'unknown',NULL,?,?)`).run(sourceId,identity,line.url??line.normalizedUrl,line.normalizedUrl,line.platform,line.extractorKey,line.mediaId??baseIdentity,null,null,now,now);}
        insert.run({id:line.id,projectId,batchId,position:start+i+1,originalText:line.originalText,url:line.url,normalizedUrl:line.normalizedUrl,platform:line.platform,extractorKey:line.extractorKey,mediaId:line.mediaId,sourceId,timestampStart:line.timestampStartSeconds,timestampEnd:line.timestampEndSeconds,note:line.note,audioMode:line.audioMode,validity:line.validity,warnings:JSON.stringify(line.warnings),errors:JSON.stringify(line.errors),now});});
      this.db.prepare(`DELETE FROM media_sources
        WHERE NOT EXISTS (SELECT 1 FROM project_items WHERE project_items.source_id=media_sources.id)
          AND NOT EXISTS (SELECT 1 FROM queue_jobs WHERE queue_jobs.source_id=media_sources.id)`).run();
    });return this.list(projectId);
  }
  public reorder(projectId:string,itemIds:string[]):ProjectItem[]{runInTransaction(this.db,()=>itemIds.forEach((id,i)=>this.db.prepare('UPDATE project_items SET position=?,updated_at=? WHERE id=? AND project_id=?').run(i+1,new Date().toISOString(),id,projectId)));return this.list(projectId);}
  public get(id:string):ProjectItem|null{const row=this.db.prepare('SELECT * FROM project_items WHERE id=?').get(id) as Row|undefined;return row?map(row):null;}
  public setClipFile(id:string,path:string|null):void{this.db.prepare('UPDATE project_items SET clip_file=?,updated_at=? WHERE id=?').run(path,new Date().toISOString(),id);}
  public remove(ids:string[]):void{const stmt=this.db.prepare('DELETE FROM project_items WHERE id=?');runInTransaction(this.db,()=>ids.forEach(id=>stmt.run(id)));}
}
