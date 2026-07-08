import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { RejectionHotspotsTool } from "./rejection-hotspots.tool";
import type { RejectionHotspotsService } from "../../../orchestration/rejection-hotspots.service";

describe("RejectionHotspotsTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  const svc = {
    getHotspots: vi.fn(() =>
      Promise.resolve([
        { area: "apps/api/src/*", count: 3, failureTypes: { test_failure: 3 } },
      ]),
    ),
  } as unknown as RejectionHotspotsService;
  const tool = new RejectionHotspotsTool(svc);

  it("has the read tool name", () => {
    expect(tool.getName()).toBe("kanban.rejection_hotspots");
  });

  it("returns aggregated hotspots", async () => {
    const result = await tool.execute(context, { project_id: "project-1" });
    expect(result.hotspots[0]).toMatchObject({
      area: "apps/api/src/*",
      count: 3,
    });
  });
});
