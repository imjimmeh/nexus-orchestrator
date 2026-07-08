/**
 * Pure helpers used by {@link KanbanRetrospectiveService} to build
 * the `learning.candidate.proposed.v1` event payload and to compute
 * stable JSON fingerprints of delta snapshots (used by the
 * `no_delta` skip short-circuit). Extracted from the service file
 * (which is at the project's `max-lines` lint cap) so the candidate
 * payload stays easy to reason about in isolation.
 */

import { createHash } from "node:crypto";
import {
  LEARNING_CANDIDATE_PROPOSED_EVENT,
  type CycleDecisionEventEvidence,
  type KanbanRetrospectiveCompletionTrigger,
  type KanbanRetrospectiveDeltaSnapshot,
  type KanbanRetrospectiveTriggerType,
} from "./retrospective.types";

const CANDIDATE_CONFIDENCE = 0.6;

export function buildCycleDecisionEvidence(
  events: CycleDecisionEventEvidence[],
): Array<{
  kind: string;
  id: string;
  summary: string;
  data: Record<string, unknown>;
}> {
  return events.map((event, index) => ({
    kind: "kanban_cycle_decision_event" as const,
    id: `cycle-decision-${index + 1}`,
    summary: `${event.decisionType}: ${event.reason || "No reasoning provided"}`,
    data: {
      decisionType: event.decisionType,
      reason: event.reason,
      recordedAt: event.recordedAt,
      isSubstantive: event.isSubstantive,
      idempotencyKey: event.idempotencyKey,
      provenance: event.provenance,
    },
  }));
}

export function buildLesson(
  deltaSnapshot: KanbanRetrospectiveDeltaSnapshot,
  cycleDecision: string,
): string {
  return `Kanban project ${deltaSnapshot.project.id} completed an orchestration cycle with ${deltaSnapshot.workItems.countsByStatus.done ?? 0} done items, ${deltaSnapshot.workItems.countsByStatus.blocked ?? 0} blocked items, and cycle decision ${cycleDecision}.`;
}

export function resolveCycleDecision(params: {
  trigger: KanbanRetrospectiveCompletionTrigger;
  deltaSnapshot: KanbanRetrospectiveDeltaSnapshot;
}): string {
  return (
    params.trigger.cycle_decision ??
    params.deltaSnapshot.decisions.latestCycleDecision?.decision ??
    "unknown"
  );
}

export function buildCandidatePayload(params: {
  runId: string;
  trigger: KanbanRetrospectiveCompletionTrigger;
  triggerType: KanbanRetrospectiveTriggerType;
  deltaSnapshot: KanbanRetrospectiveDeltaSnapshot;
  cycleDecisionEvents?: CycleDecisionEventEvidence[];
}): Record<string, unknown> {
  const cycleDecision = resolveCycleDecision(params);
  const lesson = buildLesson(params.deltaSnapshot, cycleDecision);
  const cycleDecisionEvidence = buildCycleDecisionEvidence(
    params.cycleDecisionEvents ?? [],
  );
  const provenance = {
    project_id: params.trigger.project_id,
    orchestration_id: params.trigger.orchestration_id ?? null,
    retrospective_run_id: params.runId,
    cycle_decision: cycleDecision,
    trigger: {
      type: params.triggerType,
      revision_marker: params.trigger.trigger_revision_marker,
      details: params.trigger.trigger_details ?? {},
    },
  };

  return {
    event_name: LEARNING_CANDIDATE_PROPOSED_EVENT,
    source_service: "kanban",
    scope_type: "kanban_project",
    scope_id: params.trigger.project_id,
    lesson,
    evidence: [
      {
        kind: "kanban_retrospective_delta",
        id: params.runId,
        summary: lesson,
        data: params.deltaSnapshot,
      },
      ...cycleDecisionEvidence,
    ],
    confidence: CANDIDATE_CONFIDENCE,
    tags: ["kanban", "retrospective", "orchestration-cycle"],
    provenance,
    project_id: params.trigger.project_id,
    orchestration_id: params.trigger.orchestration_id ?? null,
    retrospective_run_id: params.runId,
    cycle_decision: cycleDecision,
    trigger: provenance.trigger,
  };
}

export function buildCandidateEventId(
  runId: string,
  deltaSnapshot: KanbanRetrospectiveDeltaSnapshot,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        LEARNING_CANDIDATE_PROPOSED_EVENT,
        runId,
        deltaSnapshot,
      ]),
    )
    .digest("hex");

  return `kanban:learning_candidate:${runId}:${digest}`;
}

/**
 * Stable JSON serialization used by the `no_delta` short-circuit.
 * Object keys are sorted and arrays / nested objects are walked
 * recursively so two structurally equal values produce identical
 * output regardless of insertion order.
 */
export function toStableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toStableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${toStableJson(record[key])}`)
    .join(",")}}`;
}
