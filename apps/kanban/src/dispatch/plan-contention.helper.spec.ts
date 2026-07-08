import { describe, expect, it } from "vitest";
import {
  extractTargetFiles,
  findTargetFileContention,
} from "./plan-contention.helper";

const planWith = (...files: string[]) => ({
  milestones: [{ name: "M1", tasks: [{ id: "1.1", target_files: files }] }],
});

describe("extractTargetFiles", () => {
  it("flattens target_files across milestones and tasks", () => {
    const files = extractTargetFiles({
      milestones: [
        { name: "M1", tasks: [{ id: "1.1", target_files: ["a.ts", "b.ts"] }] },
        { name: "M2", tasks: [{ id: "2.1", target_files: ["b.ts", "c.ts"] }] },
      ],
    });
    expect([...files].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("returns an empty set for a missing or malformed plan", () => {
    expect(extractTargetFiles(undefined).size).toBe(0);
    expect(extractTargetFiles({}).size).toBe(0);
    expect(extractTargetFiles({ milestones: "nope" }).size).toBe(0);
  });
});

describe("findTargetFileContention", () => {
  const candidate = {
    id: "cand",
    execution_config: { implementationPlan: planWith("apps/api/foo.ts") },
  };

  it("returns the conflicting in-flight item id when files overlap", () => {
    const inFlight = [
      {
        id: "active-1",
        linked_run_id: "run-1",
        execution_config: { implementationPlan: planWith("apps/api/foo.ts") },
      },
    ];
    expect(findTargetFileContention(candidate, inFlight)).toBe("active-1");
  });

  it("returns null when no files overlap", () => {
    const inFlight = [
      {
        id: "active-1",
        linked_run_id: "run-1",
        execution_config: { implementationPlan: planWith("apps/web/bar.ts") },
      },
    ];
    expect(findTargetFileContention(candidate, inFlight)).toBeNull();
  });

  it("ignores the candidate itself", () => {
    expect(findTargetFileContention(candidate, [candidate])).toBeNull();
  });

  it("ignores items without a plan", () => {
    const inFlight = [
      { id: "active-1", linked_run_id: "run-1", execution_config: null },
    ];
    expect(findTargetFileContention(candidate, inFlight)).toBeNull();
  });
});
