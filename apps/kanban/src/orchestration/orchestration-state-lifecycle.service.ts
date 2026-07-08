import { Injectable } from "@nestjs/common";
import { selectRecentWindow } from "./decision-window.helper";
import { toPublicDecisionEntry } from "./orchestration-decision-log.utils";
import type {
  DecisionEntry,
  OrchestrationPersistenceRecord,
  ResolvedStartupContext,
} from "./orchestration-internal.types";
import {
  toOrchestrationMode,
  toOrchestrationStatus,
} from "./orchestration-internal.types";
import type {
  OrchestrationState,
  StartOrchestrationInput,
} from "./orchestration.types";

type StateArgs = {
  projectId: string;
  requirePersistenceState: (
    projectId: string,
  ) => Promise<OrchestrationPersistenceRecord>;
  savePersistenceState: (
    existing: OrchestrationPersistenceRecord,
    updates: Partial<OrchestrationPersistenceRecord>,
  ) => Promise<OrchestrationPersistenceRecord>;
};

type RecordImportHydrationBlockedInput =
  import("./orchestration-state-lifecycle.service.types").RecordImportHydrationBlockedInput;

type LinkedRunReconcileArgs = {
  projectId: string;
  workflowRunId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  findByProjectId: (
    projectId: string,
  ) => Promise<OrchestrationPersistenceRecord | null>;
  clearLinkedRunIfMatches: (
    projectId: string,
    workflowRunId: string,
    metadataPatch: Record<string, unknown>,
  ) => Promise<boolean>;
};

@Injectable()
export class OrchestrationStateLifecycleService {
  toState(state: OrchestrationPersistenceRecord): OrchestrationState {
    return {
      project_id: state.project_id,
      goals: state.goals,
      mode: toOrchestrationMode(state.mode),
      status: toOrchestrationStatus(state.status),
      linkedRunId: state.linked_run_id,
      updatedAt: state.updated_at.toISOString(),
    };
  }

  toProjectOrchestration(
    state: OrchestrationPersistenceRecord,
    getDecisionLog: (state: OrchestrationPersistenceRecord) => DecisionEntry[],
    opts?: { limit?: number; offset?: number },
  ) {
    const metadata = this.getRecordMetadata(state.metadata);

    const decisionLog = getDecisionLog(state).flatMap((entry) => {
      const publicEntry = toPublicDecisionEntry(entry);
      return publicEntry ? [publicEntry] : [];
    });

    return {
      id: state.project_id,
      project_id: state.project_id,
      status: state.status as
        | "idle"
        | "initializing"
        | "awaiting_approval"
        | "bootstrapping"
        | "orchestrating"
        | "paused"
        | "completed"
        | "failed",
      goals: state.goals,
      revisionFeedback: null,
      orchestrationMode: state.mode as
        | "autonomous"
        | "supervised"
        | "notifications_only",
      strategySummary: null,
      currentWorkflowRunId: state.linked_run_id,
      decisionLog: opts ? selectRecentWindow(decisionLog, opts) : decisionLog,
      metadata: state.metadata ?? null,
      probe_results: this.getRecordMetadata(metadata.probe_results),
      created_at: state.created_at.toISOString(),
      updated_at: state.updated_at.toISOString(),
    };
  }

  resolveStartupContext(
    metadata: Record<string, unknown>,
    input: StartOrchestrationInput,
  ): ResolvedStartupContext {
    const persistedSource = this.getPersistedStartupContextValue(
      metadata.sourceContext,
    ) as ResolvedStartupContext["sourceContext"] | undefined;
    const persistedReadiness = this.getPersistedStartupContextValue(
      metadata.readinessContext,
    ) as ResolvedStartupContext["readinessContext"] | undefined;
    const persistedHints = this.getPersistedStartupContextValue(
      metadata.startupHints,
    ) as ResolvedStartupContext["startupHints"] | undefined;

    const discoveryCompletedAt =
      typeof metadata.discovery_completed_at === "string"
        ? metadata.discovery_completed_at
        : undefined;

    const resolvedHints = input.startupHints ?? persistedHints;
    const startupHints = discoveryCompletedAt
      ? { ...(resolvedHints ?? {}), discoveryCompletedAt }
      : resolvedHints;

    return {
      sourceContext: input.sourceContext ?? persistedSource,
      readinessContext: input.readinessContext ?? persistedReadiness,
      startupHints,
    };
  }

  omitStartupRouteMetadata(
    metadata: Record<string, unknown>,
  ): Record<string, unknown> {
    const next = { ...metadata };
    delete next.kickoffContext;
    delete next.selectedRoute;
    delete next.selectedRuleId;
    return next;
  }

  async reconcileLinkedWorkflowRun(
    args: LinkedRunReconcileArgs,
  ): Promise<{ cleared: boolean }> {
    const existing = await args.findByProjectId(args.projectId);
    if (existing?.linked_run_id !== args.workflowRunId) {
      return { cleared: false };
    }

    const terminalMetadata = {
      last_terminal_run_id: args.workflowRunId,
      last_terminal_run_status: args.status,
      last_terminal_run_recorded_at: new Date().toISOString(),
    };

    const cleared = await args.clearLinkedRunIfMatches(
      args.projectId,
      args.workflowRunId,
      terminalMetadata,
    );

    return { cleared };
  }

  async updateSpecsReady(
    args: StateArgs & { specsReady: boolean },
  ): Promise<void> {
    const existing = await args.requirePersistenceState(args.projectId);
    const metadata = this.getRecordMetadata(existing.metadata);
    const readinessSignals =
      (metadata.readinessSignals as Record<string, boolean>) ?? {};
    readinessSignals.specs_ready = args.specsReady;
    metadata.readinessSignals = readinessSignals;
    await args.savePersistenceState(existing, { metadata });
  }

  async recordImportHydrationBlocked(
    args: StateArgs & {
      input: RecordImportHydrationBlockedInput;
    },
  ): Promise<void> {
    const existing = await args.requirePersistenceState(args.projectId);
    const metadata = this.getRecordMetadata(existing.metadata);

    metadata.blocked_stage = args.input.blocked_stage;
    metadata.ready_for_cycle = args.input.ready_for_cycle;

    const summaryReason =
      typeof args.input.hydration_summary?.reason === "string"
        ? this.normalizeOptionalText(args.input.hydration_summary.reason)
        : undefined;

    const blockedReason =
      this.normalizeOptionalText(args.input.blocked_reason) ??
      summaryReason ??
      `${args.input.blocked_stage} blocked orchestration continuation`;

    metadata.blocked_reason = blockedReason;

    if (args.input.hydration_summary) {
      metadata.hydration_summary = args.input.hydration_summary;
    }
    if (args.input.child_run_id) {
      metadata.child_run_id = args.input.child_run_id;
    }
    if (args.input.hydration_child_run_id) {
      metadata.hydration_child_run_id = args.input.hydration_child_run_id;
    }

    await args.savePersistenceState(existing, { metadata });
  }

  async clearImportHydrationBlocked(args: StateArgs): Promise<void> {
    const existing = await args.requirePersistenceState(args.projectId);
    const metadata = this.getRecordMetadata(existing.metadata);

    metadata.discovery_completed_at = new Date().toISOString();

    delete metadata.blocked_stage;
    delete metadata.blockedStage;
    delete metadata.blocked_reason;
    delete metadata.blockedReason;
    delete metadata.ready_for_cycle;
    delete metadata.hydration_summary;
    delete metadata.hydrationSummary;
    delete metadata.child_run_id;
    delete metadata.hydration_child_run_id;

    await args.savePersistenceState(existing, { metadata });
  }

  getRecordMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalizeOptionalText(value: unknown): string | undefined {
    if (value == null || typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      return undefined;
    }
    if (trimmed.toLowerCase() === "unknown") {
      return undefined;
    }
    return trimmed;
  }

  private getPersistedStartupContextValue(
    value: unknown,
  ): Record<string, unknown> | undefined {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
