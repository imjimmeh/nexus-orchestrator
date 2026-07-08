// apps/kanban/src/orchestration/orchestration-policy.service.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { OrchestrationPolicyService } from "./orchestration-policy.service";

const variablesClient = { getEffective: vi.fn(), upsert: vi.fn() };
const orchestration = { setModeMirror: vi.fn() };

describe("OrchestrationPolicyService", () => {
  let service: OrchestrationPolicyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrchestrationPolicyService(
      variablesClient as never,
      orchestration,
    );
  });

  it("returns registry defaults when no variables are set", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    const policy = await service.resolvePolicy("proj-1");
    const dispatch = policy.find((p) => p.key === "autonomy.dispatch");
    expect(dispatch?.value).toBe("auto");
    expect(dispatch?.layer).toBe("default");
    expect(policy).toHaveLength(10);
  });

  it("overlays effective values with their layer trace", async () => {
    variablesClient.getEffective.mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "ask",
        type: "string",
        layer: "proj-1",
      },
    ]);
    const policy = await service.resolvePolicy("proj-1");
    const dispatch = policy.find((p) => p.key === "autonomy.dispatch");
    expect(dispatch?.value).toBe("ask");
    expect(dispatch?.layer).toBe("proj-1");
  });

  it("rejects an invalid value before writing", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    await expect(
      service.updatePolicy("proj-1", [
        { key: "autonomy.dispatch", value: "nope" },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(variablesClient.upsert).not.toHaveBeenCalled();
  });

  it("upserts valid entries as project-scoped vars and mirrors mode", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    await service.updatePolicy("proj-1", [
      { key: "autonomy.dispatch", value: "off" },
      { key: "gates.rediscovery_merge_threshold", value: 5 },
    ]);
    expect(variablesClient.upsert).toHaveBeenCalledWith({
      scopeNodeId: "proj-1",
      key: "autonomy.dispatch",
      value: "off",
      valueType: "string",
    });
    expect(variablesClient.upsert).toHaveBeenCalledWith({
      scopeNodeId: "proj-1",
      key: "gates.rediscovery_merge_threshold",
      value: 5,
      valueType: "number",
    });
    expect(orchestration.setModeMirror).toHaveBeenCalledWith(
      "proj-1",
      "notifications_only",
    );
  });

  it("applies a preset by writing the three autonomy keys", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    await service.applyPreset("proj-1", "supervised");
    expect(variablesClient.upsert).toHaveBeenCalledTimes(3);
    expect(orchestration.setModeMirror).toHaveBeenCalledWith(
      "proj-1",
      "supervised",
    );
  });
});
