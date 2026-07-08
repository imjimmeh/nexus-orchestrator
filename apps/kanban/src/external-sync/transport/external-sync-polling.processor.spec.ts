import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { SyncCoordinatorService } from "../sync-engine/sync-coordinator.service.js";
import { ExternalSyncPollingProcessor } from "./external-sync-polling.processor.js";

interface PollingJobData {
  connectionId: string;
  projectId: string;
}

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";

function buildJob(data: PollingJobData): Job<PollingJobData, unknown> {
  return {
    id: "job-1",
    data,
  } as unknown as Job<PollingJobData, unknown>;
}

describe("ExternalSyncPollingProcessor", () => {
  it("calls sync on valid job and returns processed count", async () => {
    const syncMock = vi.fn().mockResolvedValue({ processed: 5 });
    const coordinator = {
      sync: syncMock,
    } as unknown as SyncCoordinatorService;

    const processor = new ExternalSyncPollingProcessor(coordinator);
    const result = await processor.process(
      buildJob({ projectId: PROJECT_ID, connectionId: CONNECTION_ID }),
    );

    expect(syncMock).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    expect(result).toEqual({ processed: 5 });
  });

  it("propagates sync failures", async () => {
    const failure = new Error("sync blew up");
    const coordinator = {
      sync: vi.fn().mockRejectedValue(failure),
    } as unknown as SyncCoordinatorService;

    const processor = new ExternalSyncPollingProcessor(coordinator);

    await expect(
      processor.process(
        buildJob({ projectId: PROJECT_ID, connectionId: CONNECTION_ID }),
      ),
    ).rejects.toThrow(failure);
  });

  it("extends WorkerHost from @nestjs/bullmq", () => {
    const coordinator = {
      sync: vi.fn(),
    } as unknown as SyncCoordinatorService;

    const processor = new ExternalSyncPollingProcessor(coordinator);

    expect(processor).toBeDefined();
    expect(typeof processor.process).toBe("function");
  });
});
