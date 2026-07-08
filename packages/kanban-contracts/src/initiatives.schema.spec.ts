import { describe, expect, it } from "vitest";
import {
  CreateInitiativeRequestSchema,
  InitiativeHorizonSchema,
  InitiativeSchema,
  InitiativeStatusSchema,
} from "./initiatives.schema";

describe("initiatives.schema", () => {
  it("accepts the three horizons and five statuses", () => {
    expect(InitiativeHorizonSchema.options).toEqual(["now", "next", "later"]);
    expect(InitiativeStatusSchema.options).toEqual([
      "proposed",
      "active",
      "paused",
      "done",
      "dropped",
    ]);
  });

  it("requires a title on create and defaults horizon to next", () => {
    const parsed = CreateInitiativeRequestSchema.parse({
      title: "Harden loop",
    });
    expect(parsed.horizon).toBe("next");
    expect(() => CreateInitiativeRequestSchema.parse({})).toThrow();
  });

  it("round-trips a full initiative record", () => {
    const record = {
      id: "i1",
      project_id: "p1",
      title: "Harden loop",
      description: null,
      horizon: "now" as const,
      priority: 0,
      status: "active" as const,
      goalIds: ["g1"],
      lastReviewedAt: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
    };
    expect(InitiativeSchema.parse(record)).toEqual(record);
  });
});
