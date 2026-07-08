import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Queue } from "bullmq";
import type { KanbanExternalConnectionEntity } from "../../database/entities/kanban-external-connection.entity.js";
import { KanbanExternalConnectionRepository } from "../../database/repositories/kanban-external-connection.repository.js";
import { ExternalSyncPollingScheduler } from "./external-sync-polling.scheduler.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";
const DEFAULT_POLL_INTERVAL_MS = 300000;

function buildConnection(
  overrides: Partial<KanbanExternalConnectionEntity> = {},
): KanbanExternalConnectionEntity {
  return {
    id: CONNECTION_ID,
    project_id: PROJECT_ID,
    provider_type: "jira",
    name: "Test Connection",
    status: "active",
    sync_mode: "inbound",
    sync_transport: "polling",
    config: {},
    field_mapping: {},
    webhook_secret_ref: null,
    poll_interval_seconds: null,
    last_sync_at: null,
    last_sync_error: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ExternalSyncPollingScheduler", () => {
  let queueAddMock: ReturnType<typeof vi.fn>;
  let queueRemoveRepeatableMock: ReturnType<typeof vi.fn>;
  let queueMock: Queue;
  let listActivePollingConnectionsMock: ReturnType<typeof vi.fn>;
  let repoMock: KanbanExternalConnectionRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    queueAddMock = vi.fn().mockResolvedValue({ id: "repeat-job-1" });
    queueRemoveRepeatableMock = vi.fn().mockResolvedValue(undefined);
    queueMock = {
      add: queueAddMock,
      removeJobScheduler: queueRemoveRepeatableMock,
    } as unknown as Queue;

    listActivePollingConnectionsMock = vi.fn();
    repoMock = {
      listActivePollingConnections: listActivePollingConnectionsMock,
    } as unknown as KanbanExternalConnectionRepository;
  });

  function createScheduler(): ExternalSyncPollingScheduler {
    return new ExternalSyncPollingScheduler(queueMock, repoMock);
  }

  it("registers repeatable jobs for active polling connections on init", async () => {
    const connection = buildConnection();
    listActivePollingConnectionsMock.mockResolvedValue([connection]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(listActivePollingConnectionsMock).toHaveBeenCalledOnce();
    expect(queueAddMock).toHaveBeenCalledOnce();
    expect(queueAddMock).toHaveBeenCalledWith(
      CONNECTION_ID,
      { connectionId: CONNECTION_ID, projectId: PROJECT_ID },
      expect.objectContaining({
        repeat: { every: DEFAULT_POLL_INTERVAL_MS },
        jobId: CONNECTION_ID,
      }),
    );
  });

  it("registers jobs for multiple connections", async () => {
    const conn1 = buildConnection({ id: "conn-1" });
    const conn2 = buildConnection({ id: "conn-2", project_id: "proj-2" });
    listActivePollingConnectionsMock.mockResolvedValue([conn1, conn2]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(queueAddMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenCalledWith(
      "conn-1",
      { connectionId: "conn-1", projectId: PROJECT_ID },
      expect.objectContaining({
        repeat: { every: DEFAULT_POLL_INTERVAL_MS },
        jobId: "conn-1",
      }),
    );
    expect(queueAddMock).toHaveBeenCalledWith(
      "conn-2",
      { connectionId: "conn-2", projectId: "proj-2" },
      expect.objectContaining({
        repeat: { every: DEFAULT_POLL_INTERVAL_MS },
        jobId: "conn-2",
      }),
    );
  });

  it("does not register jobs when no active polling connections exist", async () => {
    listActivePollingConnectionsMock.mockResolvedValue([]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("uses idempotent repeat key from connection id", async () => {
    const connection = buildConnection({ id: "idem-1" });
    listActivePollingConnectionsMock.mockResolvedValue([connection]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(queueAddMock).toHaveBeenCalledWith(
      "idem-1",
      expect.anything(),
      expect.objectContaining({ jobId: "idem-1" }),
    );
  });

  it("respects poll_interval_seconds when set", async () => {
    const connection = buildConnection({ poll_interval_seconds: 60 });
    listActivePollingConnectionsMock.mockResolvedValue([connection]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(queueAddMock).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.anything(),
      expect.objectContaining({
        repeat: { every: 60000 },
      }),
    );
  });

  it("falls back to default interval when poll_interval_seconds is null", async () => {
    const connection = buildConnection({ poll_interval_seconds: null });
    listActivePollingConnectionsMock.mockResolvedValue([connection]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(queueAddMock).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.anything(),
      expect.objectContaining({
        repeat: { every: DEFAULT_POLL_INTERVAL_MS },
      }),
    );
  });

  it("removes repeatable jobs on module destroy", async () => {
    const connection = buildConnection();
    listActivePollingConnectionsMock.mockResolvedValue([connection]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();
    await scheduler.onModuleDestroy();

    expect(queueRemoveRepeatableMock).toHaveBeenCalledOnce();
    expect(queueRemoveRepeatableMock).toHaveBeenCalledWith(CONNECTION_ID);
  });

  it("removes all registered repeatable jobs on destroy", async () => {
    const conn1 = buildConnection({ id: "conn-1" });
    const conn2 = buildConnection({ id: "conn-2", project_id: "proj-2" });
    listActivePollingConnectionsMock.mockResolvedValue([conn1, conn2]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();
    await scheduler.onModuleDestroy();

    expect(queueRemoveRepeatableMock).toHaveBeenCalledTimes(2);
    expect(queueRemoveRepeatableMock).toHaveBeenCalledWith("conn-1");
    expect(queueRemoveRepeatableMock).toHaveBeenCalledWith("conn-2");
  });

  it("does not register jobs for inactive connections", async () => {
    const conn1 = buildConnection({ id: "conn-1", status: "active" });
    const conn2 = buildConnection({ id: "conn-2", status: "inactive" });
    const conn3 = buildConnection({ id: "conn-3", status: "paused" });
    const conn4 = buildConnection({ id: "conn-4", status: "error" });
    listActivePollingConnectionsMock.mockResolvedValue([
      conn1,
      conn2,
      conn3,
      conn4,
    ]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledWith(
      "conn-1",
      { connectionId: "conn-1", projectId: PROJECT_ID },
      expect.objectContaining({
        repeat: { every: DEFAULT_POLL_INTERVAL_MS },
        jobId: "conn-1",
      }),
    );
  });

  it("does not register jobs for outbound-only connections", async () => {
    const conn1 = buildConnection({ id: "conn-1", sync_mode: "inbound" });
    const conn2 = buildConnection({ id: "conn-2", sync_mode: "bidirectional" });
    const conn3 = buildConnection({ id: "conn-3", sync_mode: "outbound" });
    listActivePollingConnectionsMock.mockResolvedValue([conn1, conn2, conn3]);

    const scheduler = createScheduler();
    await scheduler.onModuleInit();

    expect(queueAddMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenCalledWith(
      "conn-1",
      { connectionId: "conn-1", projectId: PROJECT_ID },
      expect.objectContaining({
        repeat: { every: DEFAULT_POLL_INTERVAL_MS },
        jobId: "conn-1",
      }),
    );
    expect(queueAddMock).toHaveBeenCalledWith(
      "conn-2",
      { connectionId: "conn-2", projectId: PROJECT_ID },
      expect.objectContaining({
        repeat: { every: DEFAULT_POLL_INTERVAL_MS },
        jobId: "conn-2",
      }),
    );
  });
});
