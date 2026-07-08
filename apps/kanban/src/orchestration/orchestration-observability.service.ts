import { Injectable } from "@nestjs/common";
import { resolveProjectDispatchCapacity } from "../dispatch/project-dispatch-capacity";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { selectRecentWindow } from "./decision-window.helper";
import { findTargetBranchBlockers } from "./orchestration-branch-blockers";
import { toPublicDecisionEntry } from "./orchestration-decision-log.utils";
import type { DiagnosticsResult } from "./orchestration-observability.service.types";
import {
  isStoppedLifecycleStatus,
  resolveNonAutoWakeDecision,
} from "./orchestration-stop-decisions";
import type {
  ActionRequest,
  ActivityEntry,
  DecisionEntry,
  OrchestrationPersistenceRecord,
  PublicDecisionEntry,
  StopCycleDecision,
  WakeupCooldownState,
} from "./orchestration-internal.types";

type StateArgs = {
  projectId: string;
  requirePersistenceState: (
    projectId: string,
  ) => Promise<OrchestrationPersistenceRecord>;
};

type PersistArgs = StateArgs & {
  savePersistenceState: (
    existing: OrchestrationPersistenceRecord,
    updates: Partial<OrchestrationPersistenceRecord>,
  ) => Promise<OrchestrationPersistenceRecord>;
};

type DiagnosticsArgs = StateArgs & {
  getDecisionLog: (state: OrchestrationPersistenceRecord) => DecisionEntry[];
  getActionRequests: (state: OrchestrationPersistenceRecord) => ActionRequest[];
  getProjectDispatchMaxActive: () => Promise<number>;
  limit?: number;
  offset?: number;
};

export type { DiagnosticsResult } from "./orchestration-observability.service.types";

@Injectable()
export class OrchestrationObservabilityService {
  constructor(
    private readonly workItems: KanbanWorkItemRepository,
  ) {}

  async getDiagnostics(args: DiagnosticsArgs): Promise<DiagnosticsResult> {
    const existing = await args.requirePersistenceState(args.projectId);
    const metadata = this.getRecordMetadata(existing.metadata);
    const decisionLog = args.getDecisionLog(existing);
    const actionRequests = args.getActionRequests(existing);
    const reasons: Array<{
      code: string;
      message: string;
      remediation?: string;
    }> = [];

    if (existing.status === "paused") {
      reasons.push({
        code: "orchestration_paused",
        message: "Orchestration is currently paused.",
      });
    }

    const blockedHydrationReason =
      this.getBlockedImportHydrationReason(metadata);
    if (blockedHydrationReason) {
      reasons.push(blockedHydrationReason);
    }

    const pendingCount = actionRequests.filter(
      (request) => request.status === "pending",
    ).length;

    if (pendingCount > 0) {
      reasons.push({
        code: "pending_action_approval",
        message: `${pendingCount} action request(s) awaiting approval.`,
      });
    }

    const workItems = await this.workItems.findByproject_id(args.projectId);
    for (const blocker of findTargetBranchBlockers(
      workItems,
    )) {
      const ownerLabels = blocker.owners.map((owner) =>
        owner.title ? `${owner.title} (${owner.id})` : owner.id,
      );
      reasons.push({
        code: "target_branch_blocked",
        message: `Todo work item ${blocker.item.title ?? blocker.item.id} is blocked by target branch ${blocker.branch}; ${blocker.owners.length.toString()} active owner(s): ${ownerLabels.join(", ")}.`,
        remediation:
          "Resolve the active owner, move the todo to a unique target branch, or unblock human decisions.",
      });
    }

    const mappedPublicList = decisionLog
      .map((entry) => toPublicDecisionEntry(entry))
      .filter((entry): entry is PublicDecisionEntry => entry !== null);
    const decisionHistory = selectRecentWindow(mappedPublicList, {
      limit: args.limit,
      offset: args.offset,
    });
    const dispatchCapacity = resolveProjectDispatchCapacity(
      workItems,
      await args.getProjectDispatchMaxActive(),
    );

    return {
      project_id: args.projectId,
      blocked: reasons.length > 0,
      reasons,
      currentBlockedReason: reasons[0] ?? null,
      decisionCount: decisionLog.length,
      decisionHistory,
      pendingActionRequestCount: pendingCount,
      lastDecision: decisionLog.at(-1) ?? null,
      dispatch_capacity: {
        maxActive: dispatchCapacity.maxActive,
        activeCount: dispatchCapacity.activeCount,
        availableSlots: dispatchCapacity.availableSlots,
        projectAvailableSlots: dispatchCapacity.projectAvailableSlots,
        agentCapacityEnabled: false,
        configuredAgentCount: 0,
        idleAgentCount: 0,
        agentAvailableSlots: 0,
      },
    };
  }

  async getActivitySummary(
    args: StateArgs & {
      limit: number;
      getDecisionLog: (
        state: OrchestrationPersistenceRecord,
      ) => DecisionEntry[];
      getActionRequests: (
        state: OrchestrationPersistenceRecord,
      ) => ActionRequest[];
    },
  ): Promise<{ totalActionCount: number; recent: Array<ActivityEntry> }> {
    const existing = await args.requirePersistenceState(args.projectId);
    const decisionLog = args.getDecisionLog(existing);
    const actionRequests = args.getActionRequests(existing);
    const totalActionCount = decisionLog.length + actionRequests.length;

    const decisionEntries = decisionLog
      .slice()
      .reverse()
      .slice(0, args.limit)
      .map((entry) => ({
        kind: "decision" as const,
        timestamp: entry.timestamp,
        summary: entry.reasoning ?? entry.type,
        ...(entry.executionStatus !== undefined
          ? { status: entry.executionStatus }
          : {}),
      }));

    const actionEntries = actionRequests
      .slice()
      .reverse()
      .slice(0, args.limit)
      .map((request) => ({
        kind: "action_request" as const,
        timestamp: request.created_at,
        summary: request.action,
        status: request.status,
      }));

    const combined = [...decisionEntries, ...actionEntries]
      .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
      .slice(0, args.limit);

    return { totalActionCount, recent: combined };
  }

  getAutoWakeSuppressionState(state: OrchestrationPersistenceRecord | null): {
    suppressed: boolean;
    decision?: StopCycleDecision;
  } {
    const decision = state ? resolveNonAutoWakeDecision(state) : undefined;
    const statusStopped = state
      ? isStoppedLifecycleStatus(state.status)
      : false;

    return {
      suppressed: decision !== undefined || statusStopped,
      ...(decision !== undefined ? { decision } : {}),
    };
  }

  getWakeupCooldownState(
    state: OrchestrationPersistenceRecord | null,
  ): WakeupCooldownState | null {
    const metadata = this.getRecordMetadata(state?.metadata);
    const lastWakeup = this.getRecordMetadata(metadata.lastWakeup);
    const cooldownState: WakeupCooldownState = {};

    if (typeof lastWakeup.lastWakeupAt === "string") {
      cooldownState.lastWakeupAt = lastWakeup.lastWakeupAt;
    }
    if (typeof lastWakeup.source === "string") {
      cooldownState.source = lastWakeup.source;
    }
    if (typeof lastWakeup.reason === "string") {
      cooldownState.reason = lastWakeup.reason;
    }

    const lastStaleWakeup = this.getRecordMetadata(metadata.lastStaleWakeup);
    if (typeof lastStaleWakeup.lastWakeupAt === "string") {
      cooldownState.lastStaleWakeupAt = lastStaleWakeup.lastWakeupAt;
    }
    if (typeof lastStaleWakeup.source === "string") {
      cooldownState.lastStaleSource = lastStaleWakeup.source;
    }
    if (typeof lastStaleWakeup.reason === "string") {
      cooldownState.lastStaleReason = lastStaleWakeup.reason;
    }

    return Object.keys(cooldownState).length > 0 ? cooldownState : null;
  }

  async recordWakeup(
    args: PersistArgs & {
      input: { source: string; reason: string };
    },
  ): Promise<void> {
    const existing = await args.requirePersistenceState(args.projectId);
    const metadata = this.getRecordMetadata(existing.metadata);
    const lastWakeup = this.getRecordMetadata(metadata.lastWakeup);
    const lastStaleWakeup = this.getRecordMetadata(metadata.lastStaleWakeup);

    if (
      !this.isStaleReconcilerWakeupMetadata(lastStaleWakeup) &&
      this.isStaleReconcilerWakeupMetadata(lastWakeup)
    ) {
      metadata.lastStaleWakeup = lastWakeup;
    }

    const wakeup = {
      lastWakeupAt: new Date(Date.now()).toISOString(),
      source: args.input.source,
      reason: args.input.reason,
    };

    metadata.lastWakeup = wakeup;

    if (this.isStaleReconcilerWakeup(args.input)) {
      metadata.lastStaleWakeup = wakeup;
    }

    await args.savePersistenceState(existing, { metadata });
  }

  isAutoWakeEnabled(state: OrchestrationPersistenceRecord): boolean {
    return resolveNonAutoWakeDecision(state) === undefined;
  }

  private isStaleReconcilerWakeup(input: {
    source: string;
    reason: string;
  }): boolean {
    return (
      input.reason === "stale_reconciler" &&
      input.source === "orchestration_continuation_reconciler"
    );
  }

  private isStaleReconcilerWakeupMetadata(
    metadata: Record<string, unknown>,
  ): boolean {
    return (
      metadata.reason === "stale_reconciler" &&
      metadata.source === "orchestration_continuation_reconciler" &&
      typeof metadata.lastWakeupAt === "string"
    );
  }

  private hasBlockedImportHydration(
    metadata: Record<string, unknown>,
  ): boolean {
    if (metadata.blocked_stage === "imported_repo_hydration") return true;
    if (metadata.blockedStage === "imported_repo_hydration") return true;

    const summary = metadata.hydration_summary ?? metadata.hydrationSummary;
    if (summary && typeof summary === "object") {
      const s = summary as Record<string, unknown>;
      if (s.status === "blocked" && s.ok === false) return true;
    }

    return false;
  }

  private getBlockedImportHydrationReason(metadata: Record<string, unknown>): {
    code: string;
    message: string;
    remediation?: string;
  } | null {
    if (!this.hasBlockedImportHydration(metadata)) return null;

    const reason =
      (typeof metadata.blocked_reason === "string"
        ? metadata.blocked_reason
        : null) ??
      (typeof metadata.blockedReason === "string"
        ? metadata.blockedReason
        : null) ??
      this.extractHydrationSummaryReason(metadata) ??
      "unknown";

    return {
      code: "import_hydration_blocked",
      message: `Import repo hydration is blocked: ${reason}`,
      remediation:
        "Review probe results and re-run imported repo synthesis and hydration.",
    };
  }

  private extractHydrationSummaryReason(
    metadata: Record<string, unknown>,
  ): string | null {
    const summary = metadata.hydration_summary ?? metadata.hydrationSummary;
    if (summary && typeof summary === "object") {
      const s = summary as Record<string, unknown>;
      return typeof s.reason === "string" ? s.reason : null;
    }
    return null;
  }

  private getRecordMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  }
}
