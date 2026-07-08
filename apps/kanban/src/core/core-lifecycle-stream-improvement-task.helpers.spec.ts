import { describe, expect, it } from "vitest";
import type { ImprovementTaskRequestedV1 } from "@nexus/core";
import {
  buildImprovementWorkItemDescription,
  severityToPriority,
} from "./core-lifecycle-stream-improvement-task.helpers";

const payload: ImprovementTaskRequestedV1 = {
  proposalId: "11111111-0000-4000-8000-000000000002",
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT and wedge the run.",
  suspectedArea: ["apps/api/src/domain-events"],
  evidence: {
    runIds: ["eac4e46e-0000-4000-8000-000000000001"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: ["ledger:123"],
  },
  severity: "high",
  occurrenceCount: 3,
};

describe("severityToPriority", () => {
  it.each([
    ["critical", "p0"],
    ["high", "p1"],
    ["medium", "p2"],
    ["low", "p2"],
  ] as const)("maps %s to %s", (severity, priority) => {
    expect(severityToPriority(severity)).toBe(priority);
  });
});

describe("buildImprovementWorkItemDescription", () => {
  it("renders brief, suspected area, evidence, and occurrence count", () => {
    const description = buildImprovementWorkItemDescription(payload);
    expect(description).toContain(payload.description);
    expect(description).toContain("apps/api/src/domain-events");
    expect(description).toContain("eac4e46e-0000-4000-8000-000000000001");
    expect(description).toContain("outbox_insert_failed");
    expect(description).toContain("ledger:123");
    expect(description).toContain("Occurrences: 3");
    expect(description).toContain(payload.proposalId);
  });

  it("omits the suspected-area section when absent", () => {
    const { suspectedArea: _omitted, ...rest } = payload;
    expect(buildImprovementWorkItemDescription(rest)).not.toContain(
      "Suspected area",
    );
  });
});
