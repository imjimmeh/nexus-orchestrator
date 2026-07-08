// apps/kanban/src/orchestration/orchestration-policy-backfill.service.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrchestrationPolicyBackfillService } from "./orchestration-policy-backfill.service";

const orchestrations = { listAllModes: vi.fn() };
const variablesClient = { getEffective: vi.fn(), upsert: vi.fn() };

describe("OrchestrationPolicyBackfillService", () => {
  let service: OrchestrationPolicyBackfillService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrchestrationPolicyBackfillService(
      orchestrations as never,
      variablesClient as never,
    );
  });

  it("backfills autonomy vars from mode when project has no project-scoped override", async () => {
    orchestrations.listAllModes.mockResolvedValue([
      { projectId: "p-sup", mode: "supervised" },
    ]);
    variablesClient.getEffective.mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "auto",
        type: "string",
        layer: "global",
      },
    ]);

    await service.onApplicationBootstrap();

    expect(variablesClient.upsert).toHaveBeenCalledWith({
      scopeNodeId: "p-sup",
      key: "autonomy.dispatch",
      value: "ask",
      valueType: "string",
    });
    expect(variablesClient.upsert).toHaveBeenCalledTimes(3);
  });

  it("skips projects that already have a project-scoped autonomy override", async () => {
    orchestrations.listAllModes.mockResolvedValue([
      { projectId: "p-set", mode: "autonomous" },
    ]);
    variablesClient.getEffective.mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "ask",
        type: "string",
        layer: "project",
      },
    ]);

    await service.onApplicationBootstrap();

    expect(variablesClient.upsert).not.toHaveBeenCalled();
  });

  it("isolates per-project failures", async () => {
    orchestrations.listAllModes.mockResolvedValue([
      { projectId: "p-bad", mode: "supervised" },
      { projectId: "p-ok", mode: "supervised" },
    ]);
    variablesClient.getEffective
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([]);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(variablesClient.upsert).toHaveBeenCalled(); // p-ok still processed
  });
});
