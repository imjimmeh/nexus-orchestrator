import { Injectable } from '@nestjs/common';
import { WorkflowRepository } from './database/repositories/workflow.repository';
import { WorkflowRunRepository } from './database/repositories/workflow-run.repository';
import { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';

@Injectable()
export class WorkflowRepositoryAggregator {
  constructor(
    public readonly workflows: WorkflowRepository,
    public readonly runs: WorkflowRunRepository,
    public readonly agentProfiles: AgentProfileRepository,
  ) {}
}
