import { Injectable } from "@nestjs/common";
import {
  CoreWorkflowRunEventEnvelopeV1Schema,
  type CoreWorkflowRunEventEnvelopeV1Shape,
} from "@nexus/core";
import { KanbanCoreRunProjectionRepository } from "../database/repositories/kanban-core-run-projection.repository";
import type {
  CoreRunProjection,
  CoreWorkflowRunLifecycleEventType,
} from "./core-run-projection.types";

type StoredCoreRunProjectionRecord = {
  run_id: string;
  workflow_id: string;
  status: string;
  project_id: string | null;
  work_item_id: string | null;
  occurred_at: Date;
  last_event_id: string;
  last_event_type: CoreWorkflowRunLifecycleEventType;
};

@Injectable()
export class CoreRunProjectionService {
  constructor(
    private readonly runProjections: KanbanCoreRunProjectionRepository,
  ) {}

  async recordCoreLifecycleEvent(
    eventInput: CoreWorkflowRunEventEnvelopeV1Shape,
  ): Promise<CoreRunProjection> {
    const event = CoreWorkflowRunEventEnvelopeV1Schema.parse(eventInput);
    const runId = event.payload.run_id;
    const existing = await this.runProjections.findByRunId(runId);

    if (existing?.last_event_id === event.event_id) {
      return this.toProjection(existing);
    }

    if (this.isStale(existing, event.occurred_at)) {
      return this.toProjection(existing);
    }

    const contextIds = this.resolveContextIds(event.payload.context);

    const projection = await this.runProjections.save({
      run_id: runId,
      workflow_id: event.payload.workflow_id,
      status: event.payload.status,
      project_id: contextIds.projectId,
      work_item_id: contextIds.workItemId,
      occurred_at: new Date(event.occurred_at),
      last_event_id: event.event_id,
      last_event_type: event.event_type,
    });

    return this.toProjection(projection);
  }

  async getProjection(runId: string): Promise<CoreRunProjection | null> {
    const projection = await this.runProjections.findByRunId(runId);
    if (!projection) {
      return null;
    }

    return this.toProjection(projection);
  }

  async listByProject(project_id: string): Promise<CoreRunProjection[]> {
    const projections = await this.runProjections.findByproject_id(project_id);
    return projections.map((projection) => this.toProjection(projection));
  }

  async hasActiveProjectWorkflowRun(
    project_id: string,
    workflowId: string,
  ): Promise<boolean> {
    return this.runProjections.hasActiveProjectWorkflowRun(
      project_id,
      workflowId,
    );
  }

  private resolveContextIds(
    context: CoreWorkflowRunEventEnvelopeV1Shape["payload"]["context"],
  ): { projectId: string | null; workItemId: string | null } {
    const projectId = context?.scopeId ?? context?.contextId ?? null;
    const metadataWorkItemId =
      context?.metadata?.workItemId ?? context?.metadata?.work_item_id;
    const fallbackWorkItemId =
      context?.contextId && context.contextId !== projectId
        ? context.contextId
        : null;
    const workItemId =
      typeof metadataWorkItemId === "string"
        ? metadataWorkItemId
        : fallbackWorkItemId;

    return { projectId, workItemId };
  }

  private isStale(
    existing: {
      occurred_at: Date;
    } | null,
    occurredAt: string,
  ): existing is {
    occurred_at: Date;
  } {
    if (!existing) {
      return false;
    }

    const incoming = Date.parse(occurredAt);
    const current = existing.occurred_at.getTime();
    if (!Number.isFinite(incoming) || !Number.isFinite(current)) {
      return false;
    }

    return incoming < current;
  }

  private toProjection(
    projection: StoredCoreRunProjectionRecord,
  ): CoreRunProjection {
    return {
      runId: projection.run_id,
      workflowId: projection.workflow_id,
      status: projection.status,
      project_id: projection.project_id,
      workItemId: projection.work_item_id,
      occurredAt: projection.occurred_at.toISOString(),
      lastEventId: projection.last_event_id,
      lastEventType: projection.last_event_type,
    };
  }
}
