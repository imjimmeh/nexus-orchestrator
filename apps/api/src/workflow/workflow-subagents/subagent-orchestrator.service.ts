import { Injectable } from '@nestjs/common';
import { SubagentCoordinationService } from './subagent-coordination.service';
import { SubagentProvisioningService } from './subagent-provisioning.service';
import type {
  SubagentAsyncSpawnParams,
  SubagentStatusResult,
  WaitForSubagentsOptions,
  WaitForSubagentsResult,
} from './subagent-orchestrator.types';

/**
 * Thin facade that re-exposes the combined public subagent surface as
 * typed methods, delegating to the focused inner services so consumers
 * can inject a single dependency instead of two.
 *
 * Restored per ADR-0003 (`docs/architecture/adr/ADR-0003-restore-subagent-orchestrator-facade.md`)
 * to replace the historical god-class `SubagentOrchestratorService` and
 * give every consumer a single import surface. Owns no behaviour of its
 * own — all logic stays in `SubagentProvisioningService` and
 * `SubagentCoordinationService`.
 */
@Injectable()
export class SubagentOrchestratorService {
  constructor(
    private readonly provisioning: SubagentProvisioningService,
    private readonly coordination: SubagentCoordinationService,
  ) {}

  spawn(
    parentContainerId: string,
    params: SubagentAsyncSpawnParams,
  ): Promise<string> {
    return this.provisioning.spawn(parentContainerId, params);
  }

  waitForSubagents(
    parentContainerId: string,
    options: WaitForSubagentsOptions = {},
  ): Promise<WaitForSubagentsResult> {
    return this.coordination.waitForSubagents(parentContainerId, options);
  }

  checkStatus(
    parentContainerId: string,
    executionId: string,
    workflowRunId?: string,
  ): Promise<SubagentStatusResult> {
    return this.coordination.checkStatus(
      parentContainerId,
      executionId,
      workflowRunId,
    );
  }

  cancelExecution(
    parentContainerId: string,
    executionId: string,
    options: { workflowRunId?: string; reason?: string } = {},
  ): Promise<boolean> {
    return this.coordination.cancelExecution(
      parentContainerId,
      executionId,
      options,
    );
  }

  cancelActiveForParent(
    parentContainerId: string,
    options: { workflowRunId?: string; reason?: string } = {},
  ): Promise<{ cancelled_execution_ids: string[] }> {
    return this.coordination.cancelActiveForParent(parentContainerId, options);
  }

  handleCompletion(
    executionId: string,
    result: Record<string, unknown>,
    workflowRunId?: string,
  ): Promise<void> {
    return this.coordination.handleCompletion(
      executionId,
      result,
      workflowRunId,
    );
  }
}
