import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TimelineRow } from '@shared/types/domain.js';
import type { MediaAnalyzer } from '../media/media-analyzer.js';
import { formatTimelineLine } from '@shared/utils/timestamp.js';
import { commitFileWithoutOverwrite } from '../files/non-conflicting-path.js';

export interface TimelineArtifact {
  txt: string | null;
  totalDuration: number;
  itemCount: number;
  rows: TimelineRow[];
}

export interface TimelineWriteOptions {
  /** V13: khi dùng lại thành phẩm cũ đã hậu kiểm, nếu cạnh MP4 đã có .timeline.txt cùng nội dung thì dùng lại, không đẻ bản "(2)". */
  reuseMatchingExisting?: boolean;
}

export class TimelineService {
  public constructor(private readonly analyzer: MediaAnalyzer) {}
  public async write(
    files: Array<{ path: string; label: string; note: string }>,
    outputFolder: string,
    productName: string,
    exportTxt: boolean,
    options?: TimelineWriteOptions
  ): Promise<TimelineArtifact> {
    let cursor = 0;
    const rows: TimelineRow[] = [];
    for (const [index, file] of files.entries()) {
      const info = await this.analyzer.analyze(file.path, `timeline-${index}`);
      const position = index + 1;
      rows.push({
        index: position,
        start: cursor,
        end: cursor + info.duration,
        duration: info.duration,
        code: formatTimelineLine(cursor, position),
        label: file.label,
        note: file.note,
        file: file.path
      });
      cursor += info.duration;
    }
    let txt: string | null = null;
    if (exportTxt) {
      const content = rows.map((row) => row.code).join('\r\n');
      const desired = join(outputFolder, `${productName}.timeline.txt`);
      if (options?.reuseMatchingExisting) {
        const existingContent = await readFile(desired, 'utf8').catch(() => null);
        if (existingContent === content) {
          return { txt: desired, totalDuration: cursor, itemCount: rows.length, rows };
        }
      }
      const pending = join(
        outputFolder,
        `${productName}.tubmedia-${randomUUID()}.timeline.pending.txt`
      );
      try {
        await writeFile(
          pending,
          content,
          { encoding: 'utf8', flag: 'wx' }
        );
        txt = await commitFileWithoutOverwrite(pending, desired);
      } catch (error) {
        await rm(pending, { force: true }).catch(() => undefined);
        throw error;
      }
    }
    return { txt, totalDuration: cursor, itemCount: rows.length, rows };
  }
}
