import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejectionHotspotsService } from "./rejection-hotspots.service";
import type { WorkItemService } from "../work-item/work-item.service";

describe("RejectionHotspotsService", () => {
  let service: RejectionHotspotsService;

  beforeEach(() => {
    const workItems = {
      listWorkItems: vi.fn(() =>
        Promise.resolve([
          {
            id: "wi-1",
            executionConfig: {
              rejectionFeedback: {
                failedDeliverables: [
                  {
                    failure_type: "test_failure",
                    affected_files: ["apps/api/src/a/x.ts"],
                  },
                ],
              },
            },
          },
          { id: "wi-2", executionConfig: null },
        ]),
      ),
    } as unknown as WorkItemService;
    service = new RejectionHotspotsService(workItems);
  });

  it("aggregates hotspots for a project", async () => {
    const result = await service.getHotspots("project-1", { depth: 3 });
    expect(result[0]).toMatchObject({ area: "apps/api/src/*", count: 1 });
  });

  it("returns the area's rejection count for a candidate file set", async () => {
    const score = await service.areaRejectionScore("project-1", [
      "apps/api/src/a/new.ts",
    ]);
    expect(score).toBe(1);
  });
});
