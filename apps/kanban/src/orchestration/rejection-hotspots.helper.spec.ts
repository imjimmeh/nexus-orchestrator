import { describe, expect, it } from "vitest";
import {
  aggregateRejectionHotspots,
  normalizeArea,
  type RejectionFeedbackLike,
} from "./rejection-hotspots.helper";

describe("normalizeArea", () => {
  it("reduces a file path to its first N path components", () => {
    expect(normalizeArea("apps/api/src/foo/bar.service.ts", 3)).toBe(
      "apps/api/src/*",
    );
    expect(normalizeArea("README.md", 3)).toBe("README.md/*");
  });
});

describe("aggregateRejectionHotspots", () => {
  it("counts failures per area and per failure type", () => {
    const result = aggregateRejectionHotspots(
      [
        {
          failedDeliverables: [
            {
              failure_type: "test_failure",
              affected_files: ["apps/api/src/a/x.ts"],
            },
            {
              failure_type: "incorrect",
              affected_files: ["apps/api/src/a/y.ts"],
            },
          ],
        },
        {
          failedDeliverables: [
            {
              failure_type: "test_failure",
              affected_files: ["apps/api/src/a/z.ts"],
            },
            {
              failure_type: "incomplete",
              affected_files: ["apps/web/src/b/w.tsx"],
            },
          ],
        },
      ],
      3,
    );

    const apiArea = result.find((h) => h.area === "apps/api/src/*");
    expect(apiArea?.count).toBe(3);
    expect(apiArea?.failureTypes.test_failure).toBe(2);
    expect(apiArea?.failureTypes.incorrect).toBe(1);

    const webArea = result.find((h) => h.area === "apps/web/src/*");
    expect(webArea?.count).toBe(1);
  });

  it("sorts hottest area first", () => {
    const result = aggregateRejectionHotspots(
      [
        {
          failedDeliverables: [
            {
              failure_type: "incorrect",
              affected_files: ["a/b/c/1.ts", "a/b/c/2.ts"],
            },
          ],
        },
        {
          failedDeliverables: [
            { failure_type: "incorrect", affected_files: ["d/e/f/3.ts"] },
          ],
        },
      ],
      3,
    );
    expect(result[0].area).toBe("a/b/c/*");
  });

  it("ignores deliverables without affected_files", () => {
    const result = aggregateRejectionHotspots(
      [{ failedDeliverables: [{ failure_type: "not_implemented" }] }],
      3,
    );
    expect(result).toEqual([]);
  });

  it("handles failedDeliverables stored as a JSONB object with numeric keys", () => {
    const result = aggregateRejectionHotspots(
      [
        {
          failedDeliverables: {
            "0": {
              failure_type: "test_failure",
              affected_files: ["apps/api/src/a/x.ts"],
            },
            "1": {
              failure_type: "incorrect",
              affected_files: ["apps/api/src/a/y.ts"],
            },
          },
        } as unknown as RejectionFeedbackLike,
      ],
      3,
    );
    const apiArea = result.find((h) => h.area === "apps/api/src/*");
    expect(apiArea?.count).toBe(2);
    expect(apiArea?.failureTypes.test_failure).toBe(1);
    expect(apiArea?.failureTypes.incorrect).toBe(1);
  });

  it("handles affected_files stored as a JSONB object with numeric keys", () => {
    const result = aggregateRejectionHotspots(
      [
        {
          failedDeliverables: [
            {
              failure_type: "test_failure",
              affected_files: {
                "0": "apps/api/src/a/x.ts",
                "1": "apps/api/src/a/y.ts",
              } as unknown as string[],
            },
          ],
        },
      ],
      3,
    );
    const apiArea = result.find((h) => h.area === "apps/api/src/*");
    expect(apiArea?.count).toBe(2);
  });
});
