import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BaseRequestContextService } from "@nexus/core";
import type { WorkItemStatus } from "@nexus/kanban-contracts";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { WorkItemService } from "../work-item/work-item.service";
import type {
  ActionRequest,
  ActionRequestListItem,
  ActionRequestStatusFilter,
  OrchestrationPersistenceRecord,
} from "./orchestration-internal.types";

const REFINEMENT_PLAN_EXIT_ACTION = "approve_refinement_plan_exit";

type ActionRequestCommonArgs = {
  projectId: string;
  requirePersistenceState: (
    projectId: string,
  ) => Promise<OrchestrationPersistenceRecord>;
  savePersistenceState: (
    existing: OrchestrationPersistenceRecord,
    updates: Partial<OrchestrationPersistenceRecord>,
  ) => Promise<OrchestrationPersistenceRecord>;
};

@Injectable()
export class OrchestrationActionRequestsService {
  constructor(
    private readonly requestContext: BaseRequestContextService,
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly workItemService: WorkItemService,
  ) {}

  async requestAction(
    args: ActionRequestCommonArgs & {
      input: {
        action: string;
        payload?: Record<string, unknown> | null;
        requestedBy?: string;
        workflowRunId?: string | null;
      };
    },
  ): Promise<ActionRequest> {
    const existing = await args.requirePersistenceState(args.projectId);
    const timestamp = new Date().toISOString();
    const request: ActionRequest = {
      id: randomUUID(),
      project_id: args.projectId,
      action: args.input.action,
      payload: args.input.payload ?? null,
      workflowRunId: args.input.workflowRunId ?? existing.linked_run_id,
      modeAtRequest: existing.mode as
        | "autonomous"
        | "supervised"
        | "notifications_only",
      requestedBy: args.input.requestedBy ?? null,
      status: "pending",
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      executedAt: null,
      errorMessage: null,
      correlationId: this.requestContext.getRequestId() ?? randomUUID(),
      created_at: timestamp,
      updated_at: timestamp,
    };

    await args.savePersistenceState(existing, {
      action_requests: [...this.getActionRequests(existing), request],
    });
    return request;
  }

  async approveActionRequest(
    args: ActionRequestCommonArgs & {
      requestId: string;
      input: { approvedBy?: string };
    },
  ): Promise<ActionRequest> {
    const updated = await this.updateActionRequest({
      ...args,
      update: (request) => {
        if (request.status !== "pending") {
          throw new BadRequestException(
            `Cannot approve action request ${args.requestId} with status ${request.status}`,
          );
        }
        const timestamp = new Date().toISOString();
        return {
          ...request,
          status: "approved",
          approvedBy: args.input.approvedBy ?? null,
          approvedAt: timestamp,
          updated_at: timestamp,
        };
      },
    });

    if (
      updated.action === REFINEMENT_PLAN_EXIT_ACTION &&
      updated.payload?.workItemId &&
      updated.payload?.toStatus
    ) {
      await this.workItemService.updateStatus(
        args.projectId,
        updated.payload.workItemId as string,
        updated.payload.toStatus as WorkItemStatus,
      );
    }

    return updated;
  }

  async rejectActionRequest(
    args: ActionRequestCommonArgs & {
      requestId: string;
      input: { rejectedBy?: string; reason?: string };
    },
  ): Promise<ActionRequest> {
    return this.updateActionRequest({
      ...args,
      update: (request) => {
        if (request.status !== "pending") {
          throw new BadRequestException(
            `Cannot reject action request ${args.requestId} with status ${request.status}`,
          );
        }
        const timestamp = new Date().toISOString();
        return {
          ...request,
          status: "rejected",
          rejectedBy: args.input.rejectedBy ?? null,
          rejectedAt: timestamp,
          rejectionReason: args.input.reason ?? null,
          updated_at: timestamp,
        };
      },
    });
  }

  async listProjectActionRequests(
    args: ActionRequestCommonArgs & {
      status: ActionRequestStatusFilter;
    },
  ): Promise<ActionRequest[]> {
    const existing = await args.requirePersistenceState(args.projectId);
    return this.filterActionRequests(
      this.getActionRequests(existing),
      args.status,
    );
  }

  async listActionRequests(
    status: ActionRequestStatusFilter,
  ): Promise<ActionRequestListItem[]> {
    const states =
      (await this.orchestrations.findAll()) as OrchestrationPersistenceRecord[];
    return states.flatMap((state) =>
      this.filterActionRequests(this.getActionRequests(state), status).map(
        (request) => ({
          ...request,
          projectName: null,
          workflowId: null,
        }),
      ),
    );
  }

  getActionRequests(state: OrchestrationPersistenceRecord): ActionRequest[] {
    return Array.isArray(state.action_requests) ? state.action_requests : [];
  }

  filterActionRequests(
    requests: ActionRequest[],
    status: ActionRequestStatusFilter,
  ): ActionRequest[] {
    if (status === "all") {
      return requests;
    }

    if (status === "pending") {
      return requests.filter((request) => request.status === "pending");
    }

    return requests.filter((request) => request.status !== "pending");
  }

  private async updateActionRequest(
    args: ActionRequestCommonArgs & {
      requestId: string;
      update: (request: ActionRequest) => ActionRequest;
    },
  ): Promise<ActionRequest> {
    const existing = await args.requirePersistenceState(args.projectId);
    const actionRequests = this.getActionRequests(existing);
    const requestIndex = actionRequests.findIndex(
      (request) => request.id === args.requestId,
    );
    if (requestIndex < 0) {
      throw new NotFoundException(`Action request ${args.requestId} not found`);
    }

    const updated = args.update(actionRequests[requestIndex]);
    const nextRequests = [...actionRequests];
    nextRequests[requestIndex] = updated;
    await args.savePersistenceState(existing, {
      action_requests: nextRequests,
    });
    return updated;
  }
}
