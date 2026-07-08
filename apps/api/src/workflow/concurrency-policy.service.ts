import { Inject, Injectable, Logger } from '@nestjs/common';
import { IConcurrencyPolicy } from '@nexus/core';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { ConcurrencyCheckResult } from './concurrency-policy.service.types';

export type { ConcurrencyCheckResult } from './concurrency-policy.service.types';

@Injectable()
export class ConcurrencyPolicyService {
  private readonly logger = new Logger(ConcurrencyPolicyService.name);

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
  ) {}

  resolveConcurrencyScope(
    policy: IConcurrencyPolicy,
    triggerData: Record<string, unknown>,
  ): string {
    const scope = this.normalizeScopeExpression(policy.scope ?? 'global');
    if (scope === 'global') return 'global';

    const parts = scope.split('+');
    const values = parts.map((path) => {
      const segments = path.replace(/^trigger\./, '').split('.');
      let value: unknown = triggerData;
      for (const segment of segments) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[segment];
        } else {
          value = undefined;
        }
      }
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '_null_';
    });

    return values.join(':');
  }

  private normalizeScopeExpression(scope: string): string {
    const templateMatch = scope.match(/^\s*\{\{\s*(?<path>[^}]+?)\s*\}\}\s*$/u);
    return templateMatch?.groups?.path?.trim() ?? scope;
  }

  async checkAndApply(
    policy: IConcurrencyPolicy | undefined,
    workflowId: string,
    triggerData: Record<string, unknown>,
  ): Promise<ConcurrencyCheckResult> {
    if (!policy) {
      return { action: 'proceed' } as ConcurrencyCheckResult;
    }

    const concurrencyScope = this.resolveConcurrencyScope(policy, triggerData);
    const activeCount = await this.runRepo.countActiveByScope(
      workflowId,
      concurrencyScope,
    );

    if (activeCount < policy.max_runs) {
      return { action: 'proceed', concurrencyScope };
    }

    const conflictPolicy = policy.on_conflict ?? 'skip';

    switch (conflictPolicy) {
      case 'skip': {
        this.logger.log(
          `Concurrency limit reached for ${workflowId} scope=${concurrencyScope} (${activeCount}/${policy.max_runs}), skipping`,
        );
        return { action: 'skip' };
      }

      case 'queue': {
        this.logger.log(
          `Concurrency limit reached for ${workflowId} scope=${concurrencyScope} (${activeCount}/${policy.max_runs}), queuing`,
        );
        return { action: 'queue', concurrencyScope };
      }

      case 'cancel_running': {
        const oldest = await this.runRepo.findOldestRunningByScope(
          workflowId,
          concurrencyScope,
        );
        if (!oldest) {
          this.logger.warn(
            `Concurrency cancel_running for ${workflowId} scope=${concurrencyScope} but no RUNNING run found, skipping`,
          );
          return { action: 'skip' };
        }
        this.logger.log(
          `Concurrency cancel_running for ${workflowId} scope=${concurrencyScope}, cancelling run ${oldest.id}`,
        );
        return { action: 'cancel', cancelRunId: oldest.id, concurrencyScope };
      }
    }
  }
}
