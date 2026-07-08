import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemRealtimePublisher } from "./work-item-realtime.publisher";

const mockRedis = {
  publish: vi.fn(),
};

describe("WorkItemRealtimePublisher", () => {
  let publisher: WorkItemRealtimePublisher;

  beforeEach(() => {
    mockRedis.publish.mockReset();
    mockRedis.publish.mockResolvedValue(0);
    publisher = new WorkItemRealtimePublisher(mockRedis as any);
  });

  it("publishes JSON payload to channel wi:{projectId}", async () => {
    const workItem = { id: "wi-1", status: "DONE", projectId: "proj-1" } as any;
    await publisher.publish("proj-1", workItem);

    expect(mockRedis.publish).toHaveBeenCalledOnce();
    const [channel, rawPayload] = mockRedis.publish.mock.calls[0] as [
      string,
      string,
    ];
    expect(channel).toBe("wi:proj-1");

    const parsed = JSON.parse(rawPayload);
    expect(parsed).toMatchObject({
      projectId: "proj-1",
      workItem: { id: "wi-1" },
    });
  });

  it("silently swallows publish errors (best-effort)", async () => {
    mockRedis.publish.mockRejectedValueOnce(new Error("Redis down"));
    await expect(publisher.publish("proj-1", {} as any)).resolves.not.toThrow();
  });
});
