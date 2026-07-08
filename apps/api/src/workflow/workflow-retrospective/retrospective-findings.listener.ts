/**
 * `RetrospectiveFindingsListener` — the completion half of EPIC-212 Phase-2
 * Task 6.
 *
 * Launching the analyst is fire-and-forget, so the findings arrive later as a
 * `workflow.run.completed` event for the `run_retrospective` workflow. This
 * listener is deliberately THIN: it filters to the analyst workflow cheaply,
 * extracts the raw findings + correlation keys from the completed run's state,
 * and delegates ALL logic to `RetrospectiveAnalysisService.processFindings`.
 *
 * Fail-soft: any error is swallowed + warned so the shared event bus is never
 * broken. Scope-neutral throughout.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WORKFLOW_RUN_COMPLETED_EVENT } from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { RetrospectiveAnalysisService } from './retrospective-analysis.service';
import {
  extractCorrelation,
  extractIdentity,
  extractRawFindings,
} from './retrospective-findings.helpers';

/** The analyst workflow whose completion this listener reacts to. */
const RUN_RETROSPECTIVE_WORKFLOW_ID = 'run_retrospective';
const RETROSPECTIVE_ANALYST_PROFILE = 'retrospective-analyst';

@Injectable()
export class RetrospectiveFindingsListener {
  private readonly logger = new Logger(RetrospectiveFindingsListener.name);

  constructor(private readonly analysis: RetrospectiveAnalysisService) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleAnalystRunCompleted(event: WorkflowRunEvent): Promise<void> {
    // Cheap early return: ignore every non-analyst completion event.
    if (!isRetrospectiveAnalystCompletion(event)) {
      return;
    }

    try {
      const { originalRunId, scopeId } = extractCorrelation(
        event.stateVariables,
      );
      if (originalRunId === null) {
        this.logger.warn(
          `RetrospectiveFindingsListener: analyst run ${event.workflowRunId} ` +
            `carried no trigger.workflow_run_id; cannot correlate findings.`,
        );
        return;
      }

      const rawFindings = extractRawFindings(event.stateVariables);
      const { actingAgentProfileName, workflowName } = extractIdentity(
        event.stateVariables,
      );
      await this.analysis.processFindings({
        originalRunId,
        scopeId,
        rawFindings,
        actingAgentProfileName: actingAgentProfileName ?? undefined,
        workflowName: workflowName ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `RetrospectiveFindingsListener swallowed unhandled error for analyst ` +
          `run ${event.workflowRunId ?? 'unknown'}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

function isRetrospectiveAnalystCompletion(event: WorkflowRunEvent): boolean {
  if (event.workflowId === RUN_RETROSPECTIVE_WORKFLOW_ID) {
    return true;
  }
  const trigger = readRecord(event.stateVariables.trigger);
  return trigger?.agent_profile === RETROSPECTIVE_ANALYST_PROFILE;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
