import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OutputContract } from '@nexus/core';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowParserService } from '../workflow-parser.service';

/**
 * Resolves the output_contract declared for a job in a run's workflow
 * definition. Used by set_job_output to validate submitted data against the
 * declared types at submit time, so the agent receives immediate feedback
 * instead of a false-positive {ok:true}.
 */
@Injectable()
export class JobOutputContractResolverService {
  private readonly logger = new Logger(JobOutputContractResolverService.name);

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    private readonly parser: WorkflowParserService,
  ) {}

  async resolveContract(
    workflowRunId: string,
    jobId: string,
  ): Promise<OutputContract | null> {
    try {
      const run = await this.runRepo.findById(workflowRunId);
      if (!run) {
        return null;
      }
      const workflow = await this.workflowRepo.findByIdentifier(
        run.workflow_id,
        { includeInactive: true },
      );
      if (!workflow) {
        return null;
      }
      const definition = this.parser.parseWorkflow(workflow.yaml_definition);
      const job = definition.jobs?.find((candidate) => candidate.id === jobId);
      return job?.output_contract ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve output_contract for run ${workflowRunId} job ${jobId}: ${message}`,
      );
      return null;
    }
  }
}
