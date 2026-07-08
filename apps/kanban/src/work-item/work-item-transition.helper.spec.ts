import { describe, expect, it, vi } from "vitest";
import { transitionWorkItemStatus } from "./work-item-transition.helper";
import type { TransitionStatusDeps } from "./work-item-transition.types";

function buildItem() {
  return {
    id: "work-item-1",
    project_id: "project-1",
    title: "Ship feature",
    status: "in-review",
    priority: "medium",
    scope: "standard",
    description: null,
    metadata: null,
    execution_config: {},
    created_at: new Date("2026-05-12T13:00:00.000Z"),
    updated_at: new Date("2026-05-12T14:00:00.000Z"),
  };
}

describe("transitionWorkItemStatus integration forwarding", () => {
  it("forwards resolved integration settings into emitStatusChanged", async () => {
    const item = buildItem();
    const emitStatusChanged = vi.fn().mockResolvedValue(undefined);

    const deps = {
      workItems: {
        findByProjectAndId: vi.fn().mockResolvedValue(item),
        save: vi.fn().mockResolvedValue({ ...item, status: "ready-to-merge" }),
        findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
      },
      projects: {
        findById: vi.fn().mockResolvedValue({
          id: "project-1",
          repository_url: "https://github.com/acme/widgets.git",
          github_secret_id: "secret-1",
          repository_workflow_settings: {
            enabled: true,
            overrides: {},
            integration: {
              strategy: "pull-request",
              mergeMethod: "merge",
              autoMerge: false,
              preflightGate: true,
            },
          },
        }),
      },
      coreClient: {
        executeLifecycleWorkflows: vi
          .fn()
          .mockResolvedValue({ status: "passed", results: [] }),
      },
      lifecycleEventPublisher: { emitStatusChanged },
      realtimeGateway: { broadcastWorkItemUpdated: vi.fn() },
      realtimePublisher: { publish: vi.fn().mockResolvedValue(undefined) },
    } as unknown as TransitionStatusDeps;

    await transitionWorkItemStatus(deps, {
      project_id: "project-1",
      workItemId: "work-item-1",
      status: "ready-to-merge",
      actor: "system",
    });

    expect(emitStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: {
          strategy: "pull-request",
          mergeMethod: "merge",
          autoMerge: false,
          preflightGate: true,
        },
        repositoryUrl: "https://github.com/acme/widgets.git",
        githubSecretId: "secret-1",
      }),
    );
  });
});
