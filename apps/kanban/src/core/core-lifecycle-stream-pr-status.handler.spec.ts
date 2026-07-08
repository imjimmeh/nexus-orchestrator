import { describe, expect, it, vi } from "vitest";
import { CoreLifecycleStreamPrStatusHandler } from "./core-lifecycle-stream-pr-status.handler";

const payload = {
  scopeId: "project-1",
  contextId: "wi-1",
  prUrl: "https://github.com/acme/widgets/pull/42",
  checks: "failing" as const,
  reviewDecision: "changes_requested" as const,
};

function build(currentStatus: string, metadata: Record<string, unknown> = {}) {
  const workItems = {
    findByProjectAndId: vi
      .fn()
      .mockResolvedValue({ id: "wi-1", status: currentStatus, metadata }),
  };
  const workItemService = {
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkItem: vi.fn().mockResolvedValue(undefined),
  };
  const handler = new CoreLifecycleStreamPrStatusHandler(
    workItems as never,
    workItemService as never,
  );
  return { handler, workItems, workItemService };
}

describe("CoreLifecycleStreamPrStatusHandler.handle", () => {
  it("patches lifecycle.merge.checks/reviewDecision without transitioning status", async () => {
    const { handler, workItemService } = build("awaiting-pr-merge", {
      lifecycle: {
        merge: {
          status: "pull_request_opened",
          prUrl: payload.prUrl,
          openedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    });

    await handler.handle(payload);

    expect(workItemService.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          lifecycle: expect.objectContaining({
            merge: expect.objectContaining({
              status: "pull_request_opened",
              prUrl: payload.prUrl,
              openedAt: "2026-06-22T00:00:00.000Z",
              checks: "failing",
              reviewDecision: "changes_requested",
            }),
          }),
        }),
      }),
    );
    expect(workItemService.updateStatus).not.toHaveBeenCalled();
  });

  it("is idempotent: a second delivery overwrites with the same observed values", async () => {
    const { handler, workItemService } = build("awaiting-pr-merge", {
      lifecycle: {
        merge: { prUrl: payload.prUrl, checks: "passing" },
      },
    });

    await handler.handle(payload);

    const patched = workItemService.updateWorkItem.mock.calls[0][2] as {
      metadata: { lifecycle: { merge: Record<string, unknown> } };
    };
    expect(patched.metadata.lifecycle.merge.checks).toBe("failing");
    expect(patched.metadata.lifecycle.merge.reviewDecision).toBe(
      "changes_requested",
    );
  });

  it("ignores an unknown work item", async () => {
    const { handler, workItemService } = build("awaiting-pr-merge");
    (
      handler as never as {
        workItems: { findByProjectAndId: ReturnType<typeof vi.fn> };
      }
    ).workItems.findByProjectAndId.mockResolvedValue(null);

    await handler.handle(payload);

    expect(workItemService.updateWorkItem).not.toHaveBeenCalled();
  });
});
