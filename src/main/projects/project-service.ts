import { rm } from 'node:fs/promises';
import type { Project, ProjectCreateInput } from '@shared/types/domain.js';
import type { ProjectRepository } from '../database/repositories/project-repository.js';
import type { PathService } from '../storage/path-service.js';
import { ensureDirectory } from '../files/ensure-directory.js';
export class ProjectService {
  public constructor(private readonly repo: ProjectRepository, private readonly paths: PathService) {}
  public list(includeArchived = false): Project[] { return this.repo.list(includeArchived); }
  public get(id: string): Project | null { return this.repo.get(id); }
  public async create(input: ProjectCreateInput): Promise<Project> {
    const source = await this.paths.ensureWritable(input.sourceFolder); const temp = await this.paths.ensureWritable(input.tempFolder); const output = await this.paths.ensureWritable(input.outputFolder);
    const project = this.repo.create({ ...input, sourceFolder: source.path, tempFolder: temp.path, outputFolder: output.path });
    await ensureDirectory(project.quarantineFolder); return project;
  }
  public async update(id: string, patch: Partial<ProjectCreateInput>): Promise<Project> {
    for (const key of ['sourceFolder', 'tempFolder', 'outputFolder'] as const) if (patch[key]) patch[key] = (await this.paths.ensureWritable(patch[key])).path;
    return this.repo.update(id, patch);
  }
  public archive(id: string): void { this.repo.setStatus(id, 'archived'); }
  public restore(id: string): void { this.repo.setStatus(id, 'draft'); }
  public remove(id: string, deleteFiles = false): Promise<void> { const p = this.repo.get(id); this.repo.remove(id); return deleteFiles && p ? rm(p.outputFolder, { recursive: true, force: true }) : Promise.resolve(); }
  public duplicate(id: string): Project { return this.repo.duplicate(id); }
}
