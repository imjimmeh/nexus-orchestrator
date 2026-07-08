import { createHash } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { FailureClass } from "@nexus/core";
import {
  WorkItemRecordSchema,
  WorkItemStatusSchema,
} from "@nexus/kanban-contracts";
import type { RepositoryIntegrationSettings } from "@nexus/kanban-contracts";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanEventDeliveryProjectionRepository } from "../database/repositories/kanban-event-delivery-projection.repository";
import { OrchestrationRepairLaneService } from "../orchestration/control-plane/orchestration-repair-lane.service";
import { OUTBOUND_SYNC_SERVICE } from "../external-sync/outbound-sync.types.js";
import type { IOutboundSyncService } from "../external-sync/outbound-sync.types.js";
import type { WorkItemRecord } from "./work-item.types";

const STATUS_CHANGED_EVENT_NAME = "kanban.work_item.status_changed.v1";
const HUMAN_FEEDBACK_RESOLVED_EVENT_NAME =
  "kanban.work_item.human_feedback_resolved.v1";

export class FailVisibleLifecycleEventDeliveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FailVisibleLifecycleEventDeliveryError";
  }
}

export function ignoreFailVisibleLifecycleEventDeliveryError(
  error: unknown,
): void {
  if (error instanceof FailVisibleLifecycleEventDeliveryError) {
    return;
  }

  throw error;
}

function isKnownStatus(value: unknown): value is string {
  return WorkItemStatusSchema.safeParse(value).success;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build the neutral, VCS-domain trigger keys forwarded onto the status-changed
 * payload: the integration strategy config plus the repository URL and
 * `github_secret_id` the API-side PR integration strategy needs to open/track a
 * PR and resolve credentials. Each group is included only when present so a
 * direct-push/provider-less project emits an unchanged payload.
 */
function buildIntegrationPayloadFields(params: {
  integration?: Required<RepositoryIntegrationSettings>;
  repositoryUrl?: string | null;
  githubSecretId?: string | null;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (params.integration) {
    fields.integration_strategy = params.integration.strategy;
    fields.integration_merge_method = params.integration.mergeMethod;
    fields.integration_auto_merge = params.integration.autoMerge;
    fields.integration_preflight_gate = params.integration.preflightGate;
  }
  if (isNonEmptyString(params.repositoryUrl)) {
    fields.repository_url = params.repositoryUrl;
  }
  if (isNonEmptyString(params.githubSecretId)) {
    fields.github_secret_id = params.githubSecretId;
  }
  return fields;
}

function hasValidResourceContext(params: {
  projectId: string;
  workItemId: string;
  status: string;
  resource: WorkItemRecord;
}): boolean {
  if (!WorkItemRecordSchema.safeParse(params.resource).success) {
    return false;
  }

  return (
    isNonEmptyString(params.resource.id) &&
    params.resource.id === params.workItemId &&
    isNonEmptyString(params.resource.project_id) &&
    params.resource.project_id === params.projectId &&
    isNonEmptyString(params.resource.title) &&
    isKnownStatus(params.resource.status) &&
    params.resource.status === params.status &&
    isNonEmptyString(params.resource.createdAt) &&
    isNonEmptyString(params.resource.updatedAt)
  );
}

function hasValidWorkItemResource(params: {
  projectId: string;
  workItemId: string;
  resource: WorkItemRecord;
}): boolean {
  return (
    WorkItemRecordSchema.safeParse(params.resource).success &&
    isNonEmptyString(params.resource.id) &&
    params.resource.id === params.workItemId &&
    isNonEmptyString(params.resource.project_id) &&
    params.resource.project_id === params.projectId &&
    isNonEmptyString(params.resource.title) &&
    isKnownStatus(params.resource.status) &&
    isNonEmptyString(params.resource.createdAt) &&
    isNonEmptyString(params.resource.updatedAt)
  );
}

@Injectable()
export class KanbanLifecycleEventPublisher {
  constructor(
    @Inject(CoreWorkflowClientService)
    private readonly coreClient: CoreWorkflowClientService,
    private readonly deliveryProjection: KanbanEventDeliveryProjectionRepository,
    private readonly repairLane: OrchestrationRepairLaneService,
    @Optional()
    @Inject(OUTBOUND_SYNC_SERVICE)
    private readonly outboundSync?: IOutboundSyncService,
  ) {}

  async emitStatusChanged(params: {
    projectId: string;
    workItemId: string;
    status: string;
    previousStatus: string | null;
    actor: string;
    updatedAt: string;
    resource: WorkItemRecord;
    integration?: Required<RepositoryIntegrationSettings>;
    repositoryUrl?: string | null;
    githubSecretId?: string | null;
  }): Promise<void> {
    // Skip emission when status is unchanged
    if (
      params.previousStatus !== null &&
      params.previousStatus === params.status
    ) {
      return;
    }

    if (
      !isKnownStatus(params.status) ||
      (params.previousStatus !== null &&
        !isKnownStatus(params.previousStatus)) ||
      !isNonEmptyString(params.projectId) ||
      !isNonEmptyString(params.workItemId) ||
      !isNonEmptyString(params.actor) ||
      !hasValidResourceContext(params)
    ) {
      throw new BadRequestException(
        "Invalid work item status change event payload",
      );
    }

    const eventId = this.buildEventId(params);
    const payload = {
      event: STATUS_CHANGED_EVENT_NAME,
      scopeId: params.projectId,
      contextId: params.workItemId,
      workItemId: params.workItemId,
      status: params.status,
      previousStatus: params.previousStatus,
      actor: params.actor,
      resource: params.resource,
      ...buildIntegrationPayloadFields(params),
    };

    await this.deliveryProjection.recordPending({
      eventId,
      eventName: STATUS_CHANGED_EVENT_NAME,
      projectId: params.projectId,
      workItemId: params.workItemId,
      dedupeKey: eventId,
      payloadSnapshot: payload,
    });

    try {
      await this.coreClient.emitDomainEventOrThrow({
        eventId,
        eventName: STATUS_CHANGED_EVENT_NAME,
        payload,
      });
      await this.deliveryProjection.markAccepted(eventId, new Date());
      this.outboundSync
        ?.pushStatusChange({
          projectId: params.projectId,
          workItemId: params.workItemId,
          status: params.status,
          previousStatus: params.previousStatus,
        })
        .catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deliveryProjection.markFailed(eventId, message, new Date());
      await this.repairLane.recordEventDeliveryFailure({
        projectId: params.projectId,
        eventId,
        eventName: STATUS_CHANGED_EVENT_NAME,
        error: message,
        failureClass: FailureClass.EventDeliveryFailure,
      });
      throw new FailVisibleLifecycleEventDeliveryError(message, error);
    }
  }

  async emitHumanFeedbackResolved(params: {
    projectId: string;
    workItemId: string;
    response: string;
    resolvedBy: string | null;
    previousDecisionPrompt: string | null;
    updatedAt: string;
    resource: WorkItemRecord;
  }): Promise<void> {
    if (
      !isNonEmptyString(params.projectId) ||
      !isNonEmptyString(params.workItemId) ||
      !isNonEmptyString(params.response) ||
      !isNonEmptyString(params.updatedAt) ||
      !hasValidWorkItemResource(params)
    ) {
      throw new BadRequestException(
        "Invalid human feedback resolution event payload",
      );
    }

    const eventId = this.buildHumanFeedbackResolvedEventId(params);
    const payload = {
      event: HUMAN_FEEDBACK_RESOLVED_EVENT_NAME,
      scopeId: params.projectId,
      contextId: params.workItemId,
      workItemId: params.workItemId,
      response: params.response,
      resolvedBy: params.resolvedBy,
      previousDecisionPrompt: params.previousDecisionPrompt,
      resource: params.resource,
    };

    await this.deliveryProjection.recordPending({
      eventId,
      eventName: HUMAN_FEEDBACK_RESOLVED_EVENT_NAME,
      projectId: params.projectId,
      workItemId: params.workItemId,
      dedupeKey: eventId,
      payloadSnapshot: payload,
    });

    try {
      await this.coreClient.emitDomainEventOrThrow({
        eventId,
        eventName: HUMAN_FEEDBACK_RESOLVED_EVENT_NAME,
        payload,
      });
      await this.deliveryProjection.markAccepted(eventId, new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deliveryProjection.markFailed(eventId, message, new Date());
      await this.repairLane.recordEventDeliveryFailure({
        projectId: params.projectId,
        eventId,
        eventName: HUMAN_FEEDBACK_RESOLVED_EVENT_NAME,
        error: message,
        failureClass: FailureClass.EventDeliveryFailure,
      });
      throw new FailVisibleLifecycleEventDeliveryError(message, error);
    }
  }

  private buildEventId(params: {
    projectId: string;
    workItemId: string;
    status: string;
    previousStatus: string | null;
    updatedAt: string;
  }): string {
    const canonicalFacts = JSON.stringify([
      "kanban",
      STATUS_CHANGED_EVENT_NAME,
      params.projectId,
      params.workItemId,
      params.previousStatus ?? "none",
      params.status,
      params.updatedAt,
    ]);
    const digest = createHash("sha256").update(canonicalFacts).digest("hex");
    return `kanban:status_changed:${digest}`;
  }

  private buildHumanFeedbackResolvedEventId(params: {
    projectId: string;
    workItemId: string;
    response: string;
    resolvedBy: string | null;
    previousDecisionPrompt: string | null;
    updatedAt: string;
  }): string {
    const canonicalFacts = JSON.stringify([
      "kanban",
      HUMAN_FEEDBACK_RESOLVED_EVENT_NAME,
      params.projectId,
      params.workItemId,
      params.previousDecisionPrompt ?? "none",
      params.response,
      params.resolvedBy ?? "anonymous",
      params.updatedAt,
    ]);
    const digest = createHash("sha256").update(canonicalFacts).digest("hex");
    return `kanban:human_feedback_resolved:${digest}`;
  }
}
