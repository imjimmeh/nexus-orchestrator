import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ToolValidationRun } from '../entities/tool-validation-run.entity';

@Injectable()
export class ToolValidationRunRepository {
  constructor(
    @InjectRepository(ToolValidationRun)
    private readonly repository: Repository<ToolValidationRun>,
  ) {}

  async findById(id: string): Promise<ToolValidationRun | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findLatestByArtifactId(
    artifactId: string,
  ): Promise<ToolValidationRun | null> {
    return this.repository.findOne({
      where: { artifact_id: artifactId },
      order: { created_at: 'DESC' },
    });
  }

  async findByArtifactIdPaged(
    artifactId: string,
    limit = 20,
    offset = 0,
  ): Promise<[ToolValidationRun[], number]> {
    return this.repository.findAndCount({
      where: { artifact_id: artifactId },
      order: { created_at: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async create(data: Partial<ToolValidationRun>): Promise<ToolValidationRun> {
    const run = this.repository.create(data);
    return this.repository.save(run);
  }
}
