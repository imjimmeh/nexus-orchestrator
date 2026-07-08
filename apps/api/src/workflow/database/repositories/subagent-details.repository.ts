import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubagentDetails } from '../entities/subagent-details.entity';

@Injectable()
export class SubagentDetailsRepository {
  constructor(
    @InjectRepository(SubagentDetails)
    private readonly repo: Repository<SubagentDetails>,
  ) {}

  findByExecutionId(id: string): Promise<SubagentDetails | null> {
    return this.repo.findOne({ where: { execution_id: id } });
  }

  upsert(
    details: Partial<SubagentDetails> & { execution_id: string },
  ): Promise<SubagentDetails> {
    return this.repo.save(details);
  }

  findByParentContainerId(
    parentContainerId: string,
  ): Promise<SubagentDetails[]> {
    return this.repo.find({
      where: { parent_container_id: parentContainerId },
    });
  }

  async delete(executionId: string): Promise<void> {
    await this.repo.delete(executionId);
  }
}
