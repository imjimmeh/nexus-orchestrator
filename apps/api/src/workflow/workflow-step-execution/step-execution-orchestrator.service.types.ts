import { WorkflowStatus } from '@nexus/core';
import type { CapabilityPreflightService } from '../../tool/capability-preflight.service';

export interface DispatchJobResult {
  dispatched: true;
  executionId: string;
}

export type SkippedJobResult =
  | { skipped: true; reason: 'run_not_found' }
  | { skipped: true; reason: 'run_not_running'; runStatus: WorkflowStatus }
  | { skipped: true; reason: 'condition_false' }
  | {
      skipped: true;
      reason: 'capability_preflight_failed';
      preflight: Awaited<
        ReturnType<CapabilityPreflightService['preflightJobExecution']>
      >;
    };
