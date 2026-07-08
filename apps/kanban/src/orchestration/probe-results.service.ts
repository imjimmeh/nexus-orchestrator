import { Injectable } from "@nestjs/common";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import type {
  ProbeResultOutcome,
  RecordProbeResultInput,
  RecordProbeResultResult,
} from "./probe-results.service.types";
export type {
  ProbeResultOutcome,
  RecordProbeResultInput,
  RecordProbeResultResult,
} from "./probe-results.service.types";

type StoredProbeResult = {
  scope_id: string;
  outcome: ProbeResultOutcome;
  result: unknown;
  recorded_at: string;
  probe_type?: string;
  expected_output_schema?: unknown;
  evidence_refs?: string[];
  narrative_summary?: string;
};

@Injectable()
export class ProbeResultsService {
  constructor(private readonly orchestrations: KanbanOrchestrationRepository) {}

  async recordProbeResult(
    input: RecordProbeResultInput,
  ): Promise<RecordProbeResultResult> {
    const existing = await this.orchestrations.findByproject_id(
      input.projectId,
    );
    if (!existing) {
      return { ok: false, reason: "orchestration_not_found" };
    }

    const metadata = this.getRecordMetadata(existing.metadata);
    const probeResults = this.getRecordMetadata(metadata.probe_results);
    const nextMetadata: Record<string, unknown> = {
      ...metadata,
      probe_results: {
        ...probeResults,
        [input.probeScopeId]: this.toStoredProbeResult(input),
      },
    };
    await this.orchestrations.save({
      project_id: existing.project_id,
      goals: existing.goals,
      mode: existing.mode,
      status: existing.status,
      linked_run_id: existing.linked_run_id,
      decision_log: existing.decision_log,
      action_requests: existing.action_requests,
      metadata: nextMetadata,
    });

    return { ok: true };
  }

  private toStoredProbeResult(
    input: RecordProbeResultInput,
  ): StoredProbeResult {
    return {
      scope_id: input.probeScopeId,
      outcome: input.outcome,
      result: input.result,
      recorded_at: input.recordedAt,
      ...(input.probeType ? { probe_type: input.probeType } : {}),
      ...(input.expectedOutputSchema
        ? { expected_output_schema: input.expectedOutputSchema }
        : {}),
      ...(input.evidenceRefs ? { evidence_refs: input.evidenceRefs } : {}),
      ...(input.narrativeSummary
        ? { narrative_summary: input.narrativeSummary }
        : {}),
    };
  }

  private getRecordMetadata(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}
