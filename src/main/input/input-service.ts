import { readFile } from 'node:fs/promises';
import type { ProjectItem } from '@shared/types/domain.js';
import { parseInputText } from '@shared/utils/input-parser.js';
import type { ItemRepository } from '../database/repositories/item-repository.js';
export class InputService {
  public constructor(private readonly items: ItemRepository) {}
  public parse(text: string) { return parseInputText(text); }
  public import(projectId: string, text: string, mode: 'append' | 'replace'): ProjectItem[] { return this.items.import(projectId, parseInputText(text), mode); }
  public async importFile(projectId: string, path: string, mode: 'append' | 'replace'): Promise<ProjectItem[]> { return this.import(projectId, await readFile(path, 'utf8'), mode); }
  public list(projectId: string): ProjectItem[] { return this.items.list(projectId); }
  public reorder(projectId: string, itemIds: string[]): ProjectItem[] { return this.items.reorder(projectId, itemIds); }
  public remove(ids: string[]): void { this.items.remove(ids); }
}
