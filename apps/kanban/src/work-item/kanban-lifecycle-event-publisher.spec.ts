import { Test, TestingModule } from "@nestjs/testing";
import { createHash } from "node:crypto";
import { FailureClass } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FailVisibleLifecycleEventDeliveryError,
  KanbanLifecycleEventPublisher,
} from "./kanban-lifecycle-event-publisher";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import * as CoreModule from "../core/core-workflow-client.service";
import { KanbanEventDeliveryProjectionRepository } from "../database/repositories/kanban-event-delivery-projection.repository";
import { OrchestrationRepairLaneService } from "../orchestration/control-plane/orchestration-repair-lane.service";
import { OUTBOUND_SYNC_SERVICE } from "../external-sync/outbound-sync.types.js";
import type { IOutboundSyncService } from "../external-sync/outbound-sync.types.js";
import type { WorkItemRecord } from "./work-item.types";

describe("KanbanLifecycleEventPublisher", () => {
  let deliveryProjection: {
    markAccepted: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    recordPending: ReturnType<typeof vi.fn>;
  };
  let emitDomainEventMock: ReturnType<typeof vi.fn>;
  let publisher: KanbanLifecycleEventPublisher;
  let repairLane: {
    recordEventDeliveryFailure: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    deliveryProjection = {
      markAccepted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      recordPending: vi.fn().mockResolvedValue(undefined),
    };
    emitDomainEventMock = vi.fn().mockResolvedValue(undefined);
    repairLane = {
      recordEventDeliveryFailure: vi.fn().mockResolvedValue(undefined),
    };
  });

  function createPublisher(
    coreClient: CoreWorkflowClientService,
    outboundSync?: IOutboundSyncService,
  ): KanbanLifecycleEventPublisher {
    const clientWithThrow = coreClient as CoreWorkflowClientService & {
      emitDomainEventOrThrow?: ReturnType<typeof vi.fn>;
    };
    clientWithThrow.emitDomainEventOrThrow ??= emitDomainEventMock;

    return new KanbanLifecycleEventPublisher(
      clientWithThrow,
      deliveryProjection as unknown as KanbanEventDeliveryProjectionRepository,
      repairLane as unknown as OrchestrationRepairLaneService,
      outboundSync,
    );
  }

  function createResource(
    overrides: Partial<WorkItemRecord> = {},
  ): WorkItemRecord {
    return {
      id: "work-item-1",
      project_id: "project-1",
      title: "Implement event wakeups",
      status: "in-progress",
      type: "story",
      executionConfig: {},
      metadata: null,
      dependsOn: [],
      blockedBy: [],
      subtasks: [],
      createdAt: "2026-05-12T13:00:00.000Z",
      updatedAt: "2026-05-12T14:00:00.000Z",
      linkedRunId: null,
      ...overrides,
    };
  }

  function createMalformedResource(
    overrides: Record<string, unknown>,
  ): WorkItemRecord {
    return {
      ...createResource(),
      ...overrides,
    };
  }

  async function expectInvalidStatusEventResource(
    resource: WorkItemRecord,
  ): Promise<void> {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await expect(
      publisher.emitStatusChanged({
        projectId: "project-1",
        workItemId: "work-item-1",
        status: "in-progress",
        previousStatus: "todo",
        actor: "system",
        updatedAt: "2026-05-12T14:00:00.000Z",
        resource,
      }),
    ).rejects.toThrow("Invalid work item status change event payload");

    expect(emitDomainEventMock).not.toHaveBeenCalled();
  }

  it("publishes normalized status changed events to core", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "workflow",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    const callParams = emitDomainEventMock.mock.calls[0][0] as {
      eventName: string;
      eventId: string;
      payload: Record<string, unknown>;
    };

    expect(callParams.eventName).toBe("kanban.work_item.status_changed.v1");
    expect(callParams.eventId).toMatch(/^kanban:status_changed:[a-f0-9]{64}$/u);
    expect(callParams.payload.event).toBe("kanban.work_item.status_changed.v1");
    expect(callParams.payload.scopeId).toBe("project-1");
    expect(callParams.payload.contextId).toBe("work-item-1");
    expect(callParams.payload.workItemId).toBe("work-item-1");
    expect(callParams.payload.status).toBe("in-progress");
    expect(callParams.payload.previousStatus).toBe("todo");
    expect(callParams.payload.actor).toBe("workflow");
  });

  it("forwards the repository VCS identity so the PR integration strategy can resolve credentials", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "ready-to-merge",
      previousStatus: "in-review",
      actor: "workflow",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource({
        status: "ready-to-merge",
      }),
      integration: {
        strategy: "pull-request",
        mergeMethod: "merge",
        autoMerge: false,
        preflightGate: true,
      },
      repositoryUrl: "https://github.com/acme/widgets.git",
      githubSecretId: "secret-1",
    });

    const callParams = emitDomainEventMock.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    };

    expect(callParams.payload.integration_strategy).toBe("pull-request");
    expect(callParams.payload.repository_url).toBe(
      "https://github.com/acme/widgets.git",
    );
    expect(callParams.payload.github_secret_id).toBe("secret-1");
  });

  it("omits the repository VCS identity keys when the project has none", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "workflow",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    const callParams = emitDomainEventMock.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    };

    expect("repository_url" in callParams.payload).toBe(false);
    expect("github_secret_id" in callParams.payload).toBe(false);
  });

  it("records pending before publishing and accepted after successful Core delivery", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "workflow",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    const eventId = emitDomainEventMock.mock.calls[0]?.[0].eventId as string;
    expect(deliveryProjection.recordPending).toHaveBeenCalledWith({
      eventId,
      eventName: "kanban.work_item.status_changed.v1",
      projectId: "project-1",
      workItemId: "work-item-1",
      dedupeKey: eventId,
      payloadSnapshot: emitDomainEventMock.mock.calls[0]?.[0].payload,
    });
    expect(deliveryProjection.markAccepted).toHaveBeenCalledWith(
      eventId,
      expect.any(Date),
    );
    expect(
      deliveryProjection.recordPending.mock.invocationCallOrder[0],
    ).toBeLessThan(emitDomainEventMock.mock.invocationCallOrder[0] ?? 0);
    expect(emitDomainEventMock.mock.invocationCallOrder[0]).toBeLessThan(
      deliveryProjection.markAccepted.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("marks failed delivery and records repair intent when Core delivery fails", async () => {
    const deliveryError = new Error("Core unavailable");
    emitDomainEventMock.mockRejectedValueOnce(deliveryError);
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await expect(
      publisher.emitStatusChanged({
        projectId: "project-1",
        workItemId: "work-item-1",
        status: "in-progress",
        previousStatus: "todo",
        actor: "workflow",
        updatedAt: "2026-05-12T14:00:00.000Z",
        resource: createResource(),
      }),
    ).rejects.toThrow(deliveryError.message);

    const eventId = deliveryProjection.recordPending.mock.calls[0]?.[0]
      .eventId as string;
    expect(deliveryProjection.markFailed).toHaveBeenCalledWith(
      eventId,
      "Core unavailable",
      expect.any(Date),
    );
    expect(repairLane.recordEventDeliveryFailure).toHaveBeenCalledWith({
      projectId: "project-1",
      eventId,
      eventName: "kanban.work_item.status_changed.v1",
      error: "Core unavailable",
      failureClass: FailureClass.EventDeliveryFailure,
    });
  });

  it("throws a fail-visible delivery error after failure tracking succeeds", async () => {
    emitDomainEventMock.mockRejectedValueOnce(new Error("Core unavailable"));
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await expect(
      publisher.emitStatusChanged({
        projectId: "project-1",
        workItemId: "work-item-1",
        status: "in-progress",
        previousStatus: "todo",
        actor: "workflow",
        updatedAt: "2026-05-12T14:00:00.000Z",
        resource: createResource(),
      }),
    ).rejects.toBeInstanceOf(FailVisibleLifecycleEventDeliveryError);
  });

  it("includes the work item resource required by status workflows", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;
    const resource = createResource({
      status: "in-progress",
      type: "epic",
      executionConfig: {
        baseBranch: "main",
        targetBranch: "feature/event-wakeups",
        specPath: "docs/specs/event-wakeups.md",
      },
      metadata: { refinement: { hasClearedRefinementOnce: false } },
    });
    const transition: Parameters<
      KanbanLifecycleEventPublisher["emitStatusChanged"]
    >[0] & { resource: typeof resource } = {
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "workflow",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource,
    };

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged(transition);

    const callParams = emitDomainEventMock.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    };

    expect(callParams.payload.resource).toMatchObject({
      id: "work-item-1",
      type: "epic",
      executionConfig: {
        baseBranch: "main",
        targetBranch: "feature/event-wakeups",
        specPath: "docs/specs/event-wakeups.md",
      },
      metadata: { refinement: { hasClearedRefinementOnce: false } },
    });
  });

  it("emits a unique event id per transition for the same work item", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "user",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "done",
      previousStatus: "in-progress",
      actor: "user",
      updatedAt: "2026-05-12T14:01:00.000Z",
      resource: createResource({ status: "done" }),
    });

    const callParams0 = emitDomainEventMock.mock.calls[0][0] as {
      eventId: string;
    };
    const callParams1 = emitDomainEventMock.mock.calls[1][0] as {
      eventId: string;
    };

    expect(callParams0.eventId).toMatch(
      /^kanban:status_changed:[a-f0-9]{64}$/u,
    );
    expect(callParams1.eventId).toMatch(
      /^kanban:status_changed:[a-f0-9]{64}$/u,
    );
    expect(callParams0.eventId).not.toBe(callParams1.eventId);
  });

  it("emits the same event id for identical transition facts", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    const transition: Parameters<
      KanbanLifecycleEventPublisher["emitStatusChanged"]
    >[0] = {
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "user",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    };

    await publisher.emitStatusChanged(transition);
    await publisher.emitStatusChanged(transition);

    const callParams0 = emitDomainEventMock.mock.calls[0][0] as {
      eventId: string;
    };
    const callParams1 = emitDomainEventMock.mock.calls[1][0] as {
      eventId: string;
    };

    expect(callParams0.eventId).toBe(callParams1.eventId);
  });

  it("serializes null previous status with the none sentinel in event ids", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "todo",
      previousStatus: null,
      actor: "import",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource({ status: "todo" }),
    });

    const callParams = emitDomainEventMock.mock.calls[0][0] as {
      eventId: string;
      payload: Record<string, unknown>;
    };
    const canonicalFacts = JSON.stringify([
      "kanban",
      "kanban.work_item.status_changed.v1",
      "project-1",
      "work-item-1",
      "none",
      "todo",
      "2026-05-12T14:00:00.000Z",
    ]);
    const expectedEventId = `kanban:status_changed:${createHash("sha256")
      .update(canonicalFacts)
      .digest("hex")}`;

    expect(callParams.eventId).toBe(expectedEventId);
    expect(callParams.payload.previousStatus).toBeNull();
  });

  it("does not collide when transition facts contain colons", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project:1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "user",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource({ id: "work-item-1", project_id: "project:1" }),
    });

    await publisher.emitStatusChanged({
      projectId: "project",
      workItemId: "1:work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "user",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource({ id: "1:work-item-1", project_id: "project" }),
    });

    const callParams0 = emitDomainEventMock.mock.calls[0][0] as {
      eventId: string;
    };
    const callParams1 = emitDomainEventMock.mock.calls[1][0] as {
      eventId: string;
    };

    expect(callParams0.eventId).not.toBe(callParams1.eventId);
  });

  it("does not emit when previous status equals new status", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "in-progress",
      actor: "system",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    expect(emitDomainEventMock).not.toHaveBeenCalled();
  });

  it("rejects unknown target statuses before publishing", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await expect(
      publisher.emitStatusChanged({
        projectId: "project-1",
        workItemId: "work-item-1",
        status: "needs-triage",
        previousStatus: "todo",
        actor: "system",
        updatedAt: "2026-05-12T14:00:00.000Z",
        resource: createResource(),
      }),
    ).rejects.toThrow("Invalid work item status change event payload");

    expect(emitDomainEventMock).not.toHaveBeenCalled();
  });

  it("rejects missing resource context before publishing", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await expect(
      publisher.emitStatusChanged({
        projectId: "project-1",
        workItemId: "work-item-1",
        status: "in-progress",
        previousStatus: "todo",
        actor: "system",
        updatedAt: "2026-05-12T14:00:00.000Z",
        resource: createResource({ project_id: "" }),
      }),
    ).rejects.toThrow("Invalid work item status change event payload");

    expect(emitDomainEventMock).not.toHaveBeenCalled();
  });

  it("rejects resources with invalid type before publishing", async () => {
    await expectInvalidStatusEventResource(
      createMalformedResource({ type: "tiny" }),
    );
  });

  it("rejects resources with malformed subtasks before publishing", async () => {
    await expectInvalidStatusEventResource(
      createMalformedResource({ subtasks: [{ title: "Missing identifiers" }] }),
    );
  });

  it("rejects resources missing required fields before publishing", async () => {
    const resourceWithoutTitle = createResource() as Record<string, unknown>;
    delete resourceWithoutTitle.title;

    await expectInvalidStatusEventResource(resourceWithoutTitle);
  });

  it("compiles with NestJS TestModule — DI wiring is valid", async () => {
    const fakeClient = {
      emitDomainEvent: vi.fn().mockResolvedValue(undefined),
      emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KanbanLifecycleEventPublisher,
        {
          provide: CoreModule.CoreWorkflowClientService,
          useValue: fakeClient,
        },
        {
          provide: KanbanEventDeliveryProjectionRepository,
          useValue: deliveryProjection,
        },
        {
          provide: OrchestrationRepairLaneService,
          useValue: repairLane,
        },
        {
          provide: OUTBOUND_SYNC_SERVICE,
          useValue: null,
        },
      ],
    }).compile();

    expect(() => module.get(KanbanLifecycleEventPublisher)).not.toThrow();
  });

  it("calls outbound sync pushStatusChange after successful event publish (when injected)", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    const pushStatusChange = vi.fn().mockResolvedValue(undefined);
    const outboundSync: IOutboundSyncService = { pushStatusChange };

    publisher = createPublisher(coreClient, outboundSync);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "system",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    expect(pushStatusChange).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
    });
  });

  it("does not throw when pushStatusChange fails (fire-and-forget)", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    const pushStatusChange = vi
      .fn()
      .mockRejectedValue(new Error("sync failed"));
    const outboundSync: IOutboundSyncService = { pushStatusChange };

    publisher = createPublisher(coreClient, outboundSync);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "system",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    expect(pushStatusChange).toHaveBeenCalled();
  });

  it("forwards resolved integration settings as flat neutral trigger keys", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "ready-to-merge",
      previousStatus: "in-review",
      actor: "workflow",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource({ status: "ready-to-merge" }),
      integration: {
        strategy: "pull-request",
        mergeMethod: "squash",
        autoMerge: true,
        preflightGate: false,
      },
    });

    const payload = (
      emitDomainEventMock.mock.calls[0][0] as {
        payload: Record<string, unknown>;
      }
    ).payload;

    expect(payload.integration_strategy).toBe("pull-request");
    expect(payload.integration_merge_method).toBe("squash");
    expect(payload.integration_auto_merge).toBe(true);
    expect(payload.integration_preflight_gate).toBe(false);
  });

  it("omits integration keys when no integration settings supplied", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "workflow",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    const payload = (
      emitDomainEventMock.mock.calls[0][0] as {
        payload: Record<string, unknown>;
      }
    ).payload;

    expect(payload).not.toHaveProperty("integration_strategy");
  });

  it("does not call outbound sync when pushStatusChange is not injected (Optional)", async () => {
    const coreClient = {
      emitDomainEvent: emitDomainEventMock,
    } as unknown as CoreWorkflowClientService;

    publisher = createPublisher(coreClient);

    await publisher.emitStatusChanged({
      projectId: "project-1",
      workItemId: "work-item-1",
      status: "in-progress",
      previousStatus: "todo",
      actor: "system",
      updatedAt: "2026-05-12T14:00:00.000Z",
      resource: createResource(),
    });

    // Should not throw - outbound sync is optional
  });
});
