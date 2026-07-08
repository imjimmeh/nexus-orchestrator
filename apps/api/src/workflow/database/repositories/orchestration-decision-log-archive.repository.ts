import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrchestrationDecisionLogArchive } from '../entities/orchestration-decision-log-archive.entity';

@Injectable()
export class OrchestrationDecisionLogArchiveRepository {
  constructor(
    @InjectRepository(OrchestrationDecisionLogArchive)
    private readonly repository: Repository<OrchestrationDecisionLogArchive>,
  ) {}

  async appendMany(
    entries: Array<Partial<OrchestrationDecisionLogArchive>>,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this.repository.insert(entries);
  }
}
