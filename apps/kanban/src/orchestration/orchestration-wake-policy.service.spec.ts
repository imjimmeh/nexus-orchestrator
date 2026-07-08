import { describe, it, expect, vi } from "vitest";
import { OrchestrationWakePolicyService } from "./orchestration-wake-policy.service";

function build(overrides: {
  projectSettings?: unknown;
  globalValue?: unknown;
  projectThrows?: boolean;
}) {
  const projects = {
    getOrchestrationSettings: vi.fn(() => {
      if (overrides.projectThrows) return Promise.reject(new Error("boom"));
      return Promise.resolve(overrides.projectSettings ?? {});
    }),
  };
  const settings = {
    get: vi.fn(() => Promise.resolve(overrides.globalValue ?? "slot_freed")),
  };
  const service = new OrchestrationWakePolicyService(
    projects as any,
    settings as any,
  );
  return { service, projects, settings };
}

describe("OrchestrationWakePolicyService.resolveForProject", () => {
  it("returns the project override when present", async () => {
    const { service } = build({
      projectSettings: { wakePolicy: "every_terminal" },
      globalValue: "slot_freed",
    });
    await expect(service.resolveForProject("p1")).resolves.toBe(
      "every_terminal",
    );
  });

  it("falls back to the global setting", async () => {
    const { service } = build({
      projectSettings: {},
      globalValue: "every_terminal",
    });
    await expect(service.resolveForProject("p1")).resolves.toBe(
      "every_terminal",
    );
  });

  it("fails open to slot_freed when the project read throws", async () => {
    const { service } = build({ projectThrows: true });
    await expect(service.resolveForProject("p1")).resolves.toBe("slot_freed");
  });
});
