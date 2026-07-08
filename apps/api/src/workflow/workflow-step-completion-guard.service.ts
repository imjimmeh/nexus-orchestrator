import { Injectable } from '@nestjs/common';
import { WorkflowOutputContractService } from './workflow-output-contract.service';
import type {
  OutputContractTypeMismatch,
  OutputContractReconciliationMismatch,
} from './workflow-output-contract.types';
import { WorkflowParserService } from './workflow-parser.service';
import { WorkflowRepositoryAggregator } from './workflow-repository-aggregator.service';
import { sleep } from '../common/utils/async.utils';

const OUTPUT_CONTRACT_RECHECK_ATTEMPTS = 3;
const OUTPUT_CONTRACT_RECHECK_DELAY_MS = 100;

interface StepCompletionValidationResult {
  allowed: boolean;
  missing: string[];
  typeMismatches?: OutputContractTypeMismatch[];
  reconciliationMismatches?: OutputContractReconciliationMismatch[];
  feedback?: string;
}

@Injectable()
export class WorkflowStepCompletionGuardService {
  constructor(
    private readonly repositories: WorkflowRepositoryAggregator,
    private readonly workflowParser: WorkflowParserService,
    private readonly outputContractService: WorkflowOutputContractService,
  ) {}

  async validateStepCompletion(params: {
    workflowRunId: string;
    jobId: string;
  }): Promise<StepCompletionValidationResult> {
    const workflowRun = await this.repositories.runs.findById(
      params.workflowRunId,
    );
    if (!workflowRun) {
      return { allowed: true, missing: [] };
    }

    const workflow = await this.repositories.workflows.findByIdentifier(
      workflowRun.workflow_id,
      { includeInactive: true },
    );
    if (!workflow) {
      return { allowed: true, missing: [] };
    }

    const parsedWorkflow = this.workflowParser.parseWorkflow(
      workflow.yaml_definition,
    );
    const workflowJobs = parsedWorkflow.jobs ?? [];
    const job = workflowJobs.find((candidate) => candidate.id === params.jobId);

    if (!job?.output_contract) {
      return { allowed: true, missing: [] };
    }

    let validation = await this.outputContractService.validateOutputContract(
      params.workflowRunId,
      params.jobId,
      job.output_contract,
    );

    for (
      let attempt = 1;
      !validation.valid && attempt < OUTPUT_CONTRACT_RECHECK_ATTEMPTS;
      attempt += 1
    ) {
      await sleep(OUTPUT_CONTRACT_RECHECK_DELAY_MS);
      validation = await this.outputContractService.validateOutputContract(
        params.workflowRunId,
        params.jobId,
        job.output_contract,
      );
    }

    if (validation.valid) {
      return { allowed: true, missing: [] };
    }

    return {
      allowed: false,
      missing: validation.missing,
      typeMismatches: validation.invalid,
      reconciliationMismatches: validation.reconciliation,
      feedback: this.outputContractService.buildRetryPrompt(
        validation.missing,
        validation.invalid,
        validation.reconciliation,
      ),
    };
  }
}
