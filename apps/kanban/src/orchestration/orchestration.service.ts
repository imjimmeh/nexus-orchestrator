import { randomUUID } from "node:crypto";
import { forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { OrchestrationPolicyMode, ProjectOrchestration } from "@nexus/kanban-contracts";
import { BaseRequestContextService } from "@nexus/core";
import { CoreRunProjectionService } from "../core/core-run-projection.service";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { ProjectService } from "../project/project.service";
import {
  KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
  type IKanbanRetrospectiveFailureThresholdService,
} from "../retrospectives/kanban-retrospective-failure-threshold.types";
import { KanbanRetrospectiveService } from "../retrospectives/kanban-retrospective.service";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { WorkItemService } from "../work-item/work-item.service";
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
import { HumanDecisionResolutionPolicyService } from "./human-decision-resolution-policy.service";
import { OrchestrationActionRequestsService } from "./orchestration-action-requests.service";
import { OrchestrationCycleDecisionService } from "./orchestration-cycle-decision.service";
import type {
  OrchestrationCycleDecisionInput,
  OrchestrationCycleDecisionResult,
} from "./orchestration-cycle-decision.service.types";
import {
  buildPersistenceSavePayload,
  filterActionRequests,
  filterDecisionLog,
  rebuildPersistenceRecord,
} from "./orchestration-persistence.helpers";
import type {
  ActionRequest,
  ActionRequestListItem,
  ActionRequestStatusFilter,
  ActivityEntry,
  DecisionEntry,
  OrchestrationPersistenceRecord,
  StopCycleDecision,
  WakeupCooldownState,
} from "./orchestration-internal.types";
import { recoverImportedHydration } from "./orchestration-imported-hydration-recovery";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import type { DiagnosticsResult } from "./orchestration-observability.service.types";
import { OrchestrationRunRequestService } from "./orchestration-run-request.service";
import { OrchestrationStateLifecycleService } from "./orchestration-state-lifecycle.service";
import type { RecordImportHydrationBlockedInput } from "./orchestration-state-lifecycle.service.types";
import type {
  OrchestrationMode,
  OrchestrationState,
  OrchestrationStatus,
  StartOrchestrationInput,
} from "./orchestration.types";
import {
  appendStrategicIntent,
  latestStrategicIntent,
} from "./strategic/strategic-intent-timeline.helpers";
import { ProjectStrategicStateService } from "./strategic/project-strategic-state.service";
import type { ProjectStrategicState } from "./strategic/project-strategic-state.service";
import type {
  StrategicIntentPayload,
  StrategicIntentRequest,
} from "./strategic/strategic-intent-timeline.types";
import type { Initiative } from "@nexus/kanban-contracts";

type CoreWorkflowRequester = Pick<CoreWorkflowClientService, "requestWorkflowRun">;

@Injectable()
export class OrchestrationService {
  // The 18-slot `design:paramtypes` order is locked: slots 13-17 hold
  // the 5 helper services promoted in the M1 refactor and the cycle
  // decision service uses forwardRef to break the orchestrator ⇄ cycle
  // decision cycle created by the ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE token.
  constructor(
    @Inject(CoreWorkflowClientService) private readonly coreClient: CoreWorkflowRequester,
    private readonly coreRunProjections: CoreRunProjectionService,
    private readonly requestContext: BaseRequestContextService,
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly projects: ProjectService,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly humanDecisionPolicy: HumanDecisionResolutionPolicyService,
    private readonly retrospectives: KanbanRetrospectiveService,
    @Inject(KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE) private readonly failureThresholdService: IKanbanRetrospectiveFailureThresholdService,
    private readonly kanbanSettings: KanbanSettingsService,
    private readonly leaseService: OrchestrationLeaseService,
    private readonly strategicState: ProjectStrategicStateService,
    private readonly workItemService: WorkItemService,
    @Inject(forwardRef(() => OrchestrationCycleDecisionService)) private readonly cycleDecisionService: OrchestrationCycleDecisionService,
    private readonly actionRequestsService: OrchestrationActionRequestsService,
    private readonly observabilityService: OrchestrationObservabilityService,
    private readonly stateLifecycleService: OrchestrationStateLifecycleService,
    private readonly runRequestService: OrchestrationRunRequestService,
  ) {}
  async start(project_id: string, input: StartOrchestrationInput): Promise<ProjectOrchestration> {
    const { nextMetadata, startupContext } = await this.resolveStartupContext(project_id, input);
    const accepted = await this.coreClient.requestWorkflowRun(
      await this.runRequestService.buildRunRequest({
        projectId: project_id,
        input,
        startupContext,
        getRequestId: () => this.requestContext.getRequestId(),
        getCausationId: () => this.requestContext.getCausationId(),
        getProject: (pid) => this.projects.get(pid).catch(() => null),
        selectHumanDecisionPolicy: ({ orchestrationMode }) => this.humanDecisionPolicy.selectPolicy({ orchestrationMode }),
      }),
    );
    delete nextMetadata.cycle_decision;
    await this.orchestrations.save({
      project_id,
      goals: input.goals,
      mode: input.orchestrationMode ?? "supervised",
      status: "orchestrating",
      linked_run_id: accepted.run_id,
      decision_log: [],
      action_requests: [],
      metadata: { ...nextMetadata, sourceContext: startupContext.sourceContext, readinessContext: startupContext.readinessContext, startupHints: startupContext.startupHints },
    });
    return this.toProjectOrchestration(await this.requirePersistenceState(project_id));
  }
  async updateMode(project_id: string, mode: OrchestrationMode): Promise<OrchestrationState> { return this.updateState(project_id, { mode }); }
  async pause(project_id: string): Promise<OrchestrationState> { return this.updateStatus(project_id, "paused"); }
  async resume(project_id: string): Promise<OrchestrationState> { return this.updateStatus(project_id, "orchestrating"); }
  async complete(project_id: string): Promise<OrchestrationState> { return this.updateStatus(project_id, "completed"); }
  async recordDecision(
    project_id: string,
    input: Omit<DecisionEntry, "timestamp" | "correlationId"> & { correlationId?: string },
  ): Promise<DecisionEntry> {
    const existing = await this.requirePersistenceState(project_id);
    const decision: DecisionEntry = { timestamp: new Date().toISOString(), correlationId: this.requestContext.getRequestId() ?? randomUUID(), ...input };
    await this.savePersistenceState(existing, { decision_log: [...this.getDecisionLog(existing), decision] });
    return decision;
  }
  async recordDiscoveryCompleted(project_id: string, completedAt: string): Promise<void> {
    const existing = await this.requirePersistenceState(project_id);
    const metadata = this.stateLifecycleService.getRecordMetadata(existing.metadata);
    await this.savePersistenceState(existing, { metadata: { ...metadata, last_discovery_at: completedAt } });
  }
  async recordStrategicIntent(project_id: string, input: StrategicIntentRequest): Promise<StrategicIntentPayload> {
    const existing = await this.requirePersistenceState(project_id);
    const createdAt = new Date().toISOString();
    await this.savePersistenceState(existing, { decision_log: appendStrategicIntent(this.getDecisionLog(existing), input, createdAt) });
    const saved = await this.requirePersistenceState(project_id);
    const intent = latestStrategicIntent(this.getDecisionLog(saved));
    if (!intent) throw new Error(`Strategic intent not found after save for project ${project_id}`);
    return intent;
  }
  async getStrategicState(project_id: string, initiatives: Initiative[]): Promise<ProjectStrategicState> {
    return this.strategicState.buildStrategicState(project_id, initiatives);
  }
  async getDiagnostics(project_id: string, opts?: { limit?: number; offset?: number }): Promise<DiagnosticsResult> {
    return this.observabilityService.getDiagnostics({
      projectId: project_id,
      requirePersistenceState: (pid) => this.requirePersistenceState(pid),
      getDecisionLog: (state) => this.getDecisionLog(state),
      getActionRequests: (state) => this.getActionRequests(state),
      getProjectDispatchMaxActive: () => this.kanbanSettings.getNumber("work_item_dispatch_max_active_per_project"),
      limit: opts?.limit,
      offset: opts?.offset,
    });
  }
  async getActivitySummary(project_id: string, { limit = 5 }: { limit?: number } = {}): Promise<{ totalActionCount: number; recent: Array<ActivityEntry> }> {
    return this.observabilityService.getActivitySummary({
      projectId: project_id,
      limit,
      requirePersistenceState: (pid) => this.requirePersistenceState(pid),
      getDecisionLog: (state) => this.getDecisionLog(state),
      getActionRequests: (state) => this.getActionRequests(state),
    });
  }
  async getAutoWakeSuppressionState(project_id: string): Promise<{ suppressed: boolean; decision?: StopCycleDecision }> {
    return this.observabilityService.getAutoWakeSuppressionState((await this.orchestrations.findByproject_id(project_id)) as OrchestrationPersistenceRecord | null);
  }
  async getWakeupCooldownState(project_id: string): Promise<WakeupCooldownState | null> {
    return this.observabilityService.getWakeupCooldownState((await this.orchestrations.findByproject_id(project_id)) as OrchestrationPersistenceRecord | null);
  }
  async recordWakeup(project_id: string, input: { source: string; reason: string }): Promise<void> {
    await this.observabilityService.recordWakeup({ projectId: project_id, input, ...this.persistenceBindings() });
  }
  async requestAction(project_id: string, input: { action: string; payload?: Record<string, unknown> | null; requestedBy?: string; workflowRunId?: string | null }): Promise<ActionRequest> {
    return this.actionRequestsService.requestAction(this.actionDeps(project_id, input));
  }
  async approveActionRequest(project_id: string, requestId: string, input: { approvedBy?: string }): Promise<ActionRequest> {
    return this.actionRequestsService.approveActionRequest({ ...this.actionDeps(project_id, input), requestId });
  }
  async rejectActionRequest(project_id: string, requestId: string, input: { rejectedBy?: string; reason?: string }): Promise<ActionRequest> {
    return this.actionRequestsService.rejectActionRequest({ ...this.actionDeps(project_id, input), requestId });
  }
  async listProjectActionRequests(project_id: string, status: ActionRequestStatusFilter = "all"): Promise<ActionRequest[]> {
    return this.actionRequestsService.listProjectActionRequests({ projectId: project_id, status, ...this.persistenceBindings() });
  }
  async listActionRequests(status: ActionRequestStatusFilter = "all"): Promise<ActionRequestListItem[]> {
    return this.actionRequestsService.listActionRequests(status);
  }
  async get(project_id: string, opts?: { limit?: number; offset?: number }) {
    return this.stateLifecycleService.toProjectOrchestration(
      await this.requirePersistenceState(project_id),
      (record) => this.getDecisionLog(record),
      opts,
    );
  }
  async findOrchestratingStates(): Promise<OrchestrationPersistenceRecord[]> {
    return (await this.orchestrations.findByStatus("orchestrating")).filter((state) => this.observabilityService.isAutoWakeEnabled(state as OrchestrationPersistenceRecord)) as OrchestrationPersistenceRecord[];
  }
  async findOrchestratingStatesForContinuationCleanup(): Promise<OrchestrationPersistenceRecord[]> {
    return (await this.orchestrations.findByStatus("orchestrating")) as OrchestrationPersistenceRecord[];
  }
  async findByLinkedWorkflowRun(workflowRunId: string): Promise<OrchestrationPersistenceRecord | null> {
    return (await this.orchestrations.findByLinkedRunId(workflowRunId)) as OrchestrationPersistenceRecord | null;
  }
  isCycleActive(project_id: string): Promise<boolean> { return this.leaseService.hasActiveCycleLease(project_id); }
  async reconcileLinkedWorkflowRun(project_id: string, input: { workflowRunId: string; status: "COMPLETED" | "FAILED" | "CANCELLED" }): Promise<{ cleared: boolean }> {
    return this.stateLifecycleService.reconcileLinkedWorkflowRun({
      projectId: project_id,
      workflowRunId: input.workflowRunId,
      status: input.status,
      findByProjectId: (pid) => this.orchestrations.findByproject_id(pid) as Promise<OrchestrationPersistenceRecord | null>,
      clearLinkedRunIfMatches: (pid, workflowRunId, metadataPatch) => this.orchestrations.clearLinkedRunIfMatches(pid, workflowRunId, metadataPatch),
    });
  }
  async recordImportHydrationBlocked(project_id: string, input: RecordImportHydrationBlockedInput): Promise<void> {
    await this.stateLifecycleService.recordImportHydrationBlocked({ projectId: project_id, input, ...this.persistenceBindings() });
  }
  async clearImportHydrationBlocked(project_id: string, _input: { cleared_stage: string; ready_for_cycle: boolean }): Promise<void> {
    await this.stateLifecycleService.clearImportHydrationBlocked({ projectId: project_id, ...this.persistenceBindings() });
  }
  async updateSpecsReady(project_id: string, specs_ready: boolean): Promise<void> {
    await this.stateLifecycleService.updateSpecsReady({ projectId: project_id, specsReady: specs_ready, ...this.persistenceBindings() });
  }
  async recoverImportedHydration(project_id: string): Promise<ProjectOrchestration> {
    return recoverImportedHydration(project_id, {
      coreClient: this.coreClient,
      projects: this.projects,
      requestContext: this.requestContext,
      humanDecisionPolicy: this.humanDecisionPolicy,
      stateLifecycleService: this.stateLifecycleService,
      runRequestService: this.runRequestService,
      ...this.persistenceBindings(),
      clearImportHydrationBlocked: (pid, i) => this.clearImportHydrationBlocked(pid, i),
      clearCycleDecision: (pid, i) => this.clearCycleDecision(pid, i),
      toProjectOrchestration: (s) => this.toProjectOrchestration(s),
    });
  }
  async recordCycleDecision(project_id: string, input: OrchestrationCycleDecisionInput): Promise<OrchestrationCycleDecisionResult> {
    const existing = await this.requirePersistenceState(project_id);
    const metadata = this.stateLifecycleService.getRecordMetadata(existing.metadata);
    return this.cycleDecisionService.recordCycleDecision({
      projectId: project_id, existing, metadata, input,
      getDecisionLog: (state) => this.getDecisionLog(state),
      savePersistenceState: (s, u) => this.savePersistenceState(s, u),
    });
  }
  async clearCycleDecision(project_id: string, input: { reason: string }): Promise<void> {
    const existing = await this.requirePersistenceState(project_id);
    const metadata = this.stateLifecycleService.getRecordMetadata(existing.metadata);
    await this.cycleDecisionService.clearCycleDecision({
      existing, metadata, reason: input.reason,
      getDecisionLog: (state) => this.getDecisionLog(state),
      savePersistenceState: (s, u) => this.savePersistenceState(s, u),
    });
  }
  async markPendingConsecutiveFailure(project_id: string, input: { failedRunCount: number; reason: string }): Promise<void> {
    const existing = await this.requirePersistenceState(project_id);
    const metadata = this.stateLifecycleService.getRecordMetadata(existing.metadata);
    const previousCount = typeof metadata.pending_consecutive_failure_count === "number" ? metadata.pending_consecutive_failure_count : 0;
    metadata.pending_consecutive_failure_count = previousCount + Math.max(0, input.failedRunCount);
    metadata.pending_consecutive_failure_reason = input.reason;
    metadata.pending_consecutive_failure_recorded_at = new Date().toISOString();
    await this.savePersistenceState(existing, { metadata });
  }
  async clearPendingConsecutiveFailure(project_id: string): Promise<void> {
    const existing = await this.requirePersistenceState(project_id).catch(() => null);
    if (!existing) return;
    const metadata = this.stateLifecycleService.getRecordMetadata(existing.metadata);
    if (metadata.pending_consecutive_failure_count === undefined) return;
    delete metadata.pending_consecutive_failure_count;
    delete metadata.pending_consecutive_failure_reason;
    delete metadata.pending_consecutive_failure_recorded_at;
    await this.savePersistenceState(existing, { metadata });
  }
  // Denormalized display cache for the derived policy mode. The autonomy variables
  // stored via `OrchestrationPolicyService` remain the source of truth.
  async setModeMirror(projectId: string, mode: OrchestrationPolicyMode): Promise<void> {
    await this.orchestrations.updateMode(projectId, mode);
  }
  private async requireState(project_id: string): Promise<OrchestrationState> {
    return this.stateLifecycleService.toState(await this.requirePersistenceState(project_id));
  }
  private async requirePersistenceState(project_id: string): Promise<OrchestrationPersistenceRecord> {
    const state = await this.orchestrations.findByproject_id(project_id);
    if (!state) throw new NotFoundException(`Orchestration state not found for project ${project_id}`);
    return state as OrchestrationPersistenceRecord;
  }
  private async savePersistenceState(
    existing: OrchestrationPersistenceRecord,
    updates: Partial<OrchestrationPersistenceRecord>,
  ): Promise<OrchestrationPersistenceRecord> {
    const decisionLog = (s: OrchestrationPersistenceRecord) => this.getDecisionLog(s);
    const actionRequests = (s: OrchestrationPersistenceRecord) => this.getActionRequests(s);
    const payload = buildPersistenceSavePayload(existing, updates, decisionLog, actionRequests);
    const saved = (await this.orchestrations.save(payload)) as Partial<OrchestrationPersistenceRecord>;
    return rebuildPersistenceRecord(saved, existing, decisionLog, actionRequests);
  }
  private getDecisionLog(state: OrchestrationPersistenceRecord): DecisionEntry[] { return filterDecisionLog(state); }
  private getActionRequests(state: OrchestrationPersistenceRecord): ActionRequest[] { return filterActionRequests(state); }
  private toProjectOrchestration(state: OrchestrationPersistenceRecord) {
    return this.stateLifecycleService.toProjectOrchestration(state, (record) => this.getDecisionLog(record));
  }
  private actionDeps<TInput>(projectId: string, input: TInput) {
    return { projectId, input, ...this.persistenceBindings() };
  }
  private persistenceBindings() {
    return {
      requirePersistenceState: (pid: string) => this.requirePersistenceState(pid),
      savePersistenceState: (s: OrchestrationPersistenceRecord, u: Partial<OrchestrationPersistenceRecord>) => this.savePersistenceState(s, u),
    };
  }
  private async updateStatus(project_id: string, status: OrchestrationStatus): Promise<OrchestrationState> { return this.updateState(project_id, { status }); }
  private async updateState(project_id: string, updates: Partial<OrchestrationState>): Promise<OrchestrationState> {
    const existing = await this.requireState(project_id);
    const persisted = await this.requirePersistenceState(project_id);
    const next = await this.savePersistenceState(persisted, {
      goals: updates.goals ?? existing.goals,
      mode: updates.mode ?? existing.mode,
      status: updates.status ?? existing.status,
      linked_run_id: updates.linkedRunId ?? existing.linkedRunId,
    });
    return this.stateLifecycleService.toState(next);
  }
  private async resolveStartupContext(project_id: string, input: StartOrchestrationInput) {
    const existing = await this.orchestrations.findByproject_id(project_id);
    const existingMetadata = this.stateLifecycleService.getRecordMetadata(existing?.metadata);
    const nextMetadata = this.stateLifecycleService.omitStartupRouteMetadata(existingMetadata);
    const startupContext = this.stateLifecycleService.resolveStartupContext(existingMetadata, input);
    return { nextMetadata, startupContext };
  }
}
