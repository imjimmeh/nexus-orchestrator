/**
 * Pure event-payload builders for the retrospective finding-lifecycle events
 * (`retrospective.finding.received/routed/rejected`). Extracted from
 * `RetrospectiveAnalysisService` so the orchestrator only wires the built
 * payload to `EventLedgerService.emitBestEffort` — no `this`, no I/O, easy to
 * unit-test in isolation.
 */
import type { RetrospectiveFinding } from '@nexus/core';
import type { EmitEventLedgerParams } from '../../observability/event-ledger.service.types';
import type { RejectedFindingEventParams } from './retrospective-analysis-events.helpers.types';

const RETROSPECTIVE_FINDING_RECEIVED = 'retrospective.finding.received';
const RETROSPECTIVE_FINDING_REJECTED = 'retrospective.finding.rejected';
const RETROSPECTIVE_FINDING_ROUTED = 'retrospective.finding.routed';

/** Scope-neutral execution context, or `undefined` when the row carried none. */
export function buildRetrospectiveEventContext(
  scopeId: string | null,
): EmitEventLedgerParams['context'] {
  if (scopeId === null) {
    return undefined;
  }
  return {
    scopeId,
    contextId: null,
    contextType: null,
    scopeNodeId: null,
    scopePath: null,
  };
}

export function buildReceivedFindingEvent(
  originalRunId: string,
  scopeId: string | null,
  findingIndex: number,
): EmitEventLedgerParams {
  return {
    domain: 'workflow',
    eventName: RETROSPECTIVE_FINDING_RECEIVED,
    outcome: 'success',
    workflowRunId: originalRunId,
    context: buildRetrospectiveEventContext(scopeId),
    payload: { original_run_id: originalRunId, finding_index: findingIndex },
  };
}

export function buildRoutedFindingEvent(
  originalRunId: string,
  scopeId: string | null,
  findingIndex: number,
  finding: RetrospectiveFinding,
  lessonSnippet: string,
): EmitEventLedgerParams {
  return {
    domain: 'workflow',
    eventName: RETROSPECTIVE_FINDING_ROUTED,
    outcome: 'success',
    workflowRunId: originalRunId,
    context: buildRetrospectiveEventContext(scopeId),
    payload: {
      original_run_id: originalRunId,
      finding_index: findingIndex,
      terminal_outcome: 'routed',
      finding_kind: finding.kind,
      lesson_snippet: lessonSnippet,
    },
  };
}

export function buildRejectedFindingEvent(
  originalRunId: string,
  scopeId: string | null,
  params: RejectedFindingEventParams,
): EmitEventLedgerParams {
  return {
    domain: 'workflow',
    eventName: RETROSPECTIVE_FINDING_REJECTED,
    outcome: params.outcome ?? 'success',
    workflowRunId: originalRunId,
    context: buildRetrospectiveEventContext(scopeId),
    payload: {
      original_run_id: originalRunId,
      finding_index: params.findingIndex,
      terminal_outcome: params.terminalOutcome,
      reason_code: params.reasonCode,
      issues: params.issues,
      lesson_snippet: params.lessonSnippet,
    },
    errorMessage: params.errorMessage,
  };
}
