import { describe, expect, it, vi } from "vitest";
import { CoreLifecycleStreamPrMergedHandler } from "./core-lifecycle-stream-pr-merged.handler";

const payload = {
  scopeId: "project-1",
  contextId: "wi-1",
  prUrl: "https://github.com/acme/widgets/pull/42",
  mergeCommitSha: "sha-merge",
};

function build(currentStatus: string) {
  const workItems = {
    findByProjectAndId: vi
      .fn()
      .mockResolvedValue({ id: "wi-1", status: currentStatus, metadata: {} }),
  };
  const workItemService = {
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkItem: vi.fn().mockResolvedValue(undefined),
  };
  const handler = new CoreLifecycleStreamPrMergedHandler(
    workItems as never,
    workItemService as never,
  );
  return { handler, workItems, workItemService };
}

describe("CoreLifecycleStreamPrMergedHandler.handle", () => {
  it("transitions awaiting-pr-merge -> done and records the merge commit", async () => {
    const { handler, workItemService } = build("awaiting-pr-merge");

    await handler.handle(payload);

    expect(workItemService.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          lifecycle: expect.objectContaining({
            merge: expect.objectContaining({
              status: "merged",
              mergeCommit: "sha-merge",
            }),
          }),
        }),
      }),
    );
    expect(workItemService.updateStatus).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      "done",
    );
  });

  it("is a no-op when the item is already done (idempotent)", async () => {
    const { handler, workItemService } = build("done");

    await handler.handle(payload);

    expect(workItemService.updateStatus).not.toHaveBeenCalled();
  });
});
