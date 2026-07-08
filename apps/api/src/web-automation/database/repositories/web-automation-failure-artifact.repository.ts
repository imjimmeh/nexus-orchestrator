import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebAutomationFailureArtifact } from '../entities/web-automation-failure-artifact.entity';

@Injectable()
export class WebAutomationFailureArtifactRepository {
  constructor(
    @InjectRepository(WebAutomationFailureArtifact)
    private readonly repository: Repository<WebAutomationFailureArtifact>,
  ) {}

  async create(
    data: Partial<WebAutomationFailureArtifact>,
  ): Promise<WebAutomationFailureArtifact> {
    const artifact = this.repository.create(data);
    return this.repository.save(artifact);
  }

  async findById(id: string): Promise<WebAutomationFailureArtifact | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByWorkflowRunId(
    workflowRunId: string,
    limit = 20,
    offset = 0,
  ): Promise<[WebAutomationFailureArtifact[], number]> {
    return this.repository.findAndCount({
      where: { workflow_run_id: workflowRunId },
      order: { created_at: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}
