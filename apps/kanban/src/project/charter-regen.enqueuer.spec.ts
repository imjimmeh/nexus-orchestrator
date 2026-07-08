import { describe, expect, it, vi } from "vitest";
import { CharterRegenEnqueuer } from "./charter-regen.enqueuer";

describe("CharterRegenEnqueuer", () => {
  it("enqueues a debounced, retrying regen job per project", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const enqueuer = new CharterRegenEnqueuer({ add } as never);

    await enqueuer.enqueue("proj-1");

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0];
    expect(name).toBe("regen");
    expect(data).toEqual({ projectId: "proj-1" });
    expect(opts).toMatchObject({
      jobId: "charter-regen:proj-1",
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  });

  it("swallows queue errors so the caller is never broken", async () => {
    const add = vi.fn().mockRejectedValue(new Error("redis down"));
    const enqueuer = new CharterRegenEnqueuer({ add } as never);

    await expect(enqueuer.enqueue("proj-1")).resolves.toBeUndefined();
  });
});
