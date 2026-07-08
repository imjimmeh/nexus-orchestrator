import { describe, it, expect, vi } from "vitest";
import { CharterAggregateService } from "./charter-aggregate.service";

it("returns vision, goals, and sections keyed by category", async () => {
  const goals = {
    listGoals: vi.fn().mockResolvedValue([{ id: "g1", title: "Ship" }]),
  };
  const memories = {
    getCharterMemories: vi.fn().mockResolvedValue([
      { id: "m1", content: "Be great", metadata: { category: "vision" } },
      { id: "m2", content: "SSO", metadata: { category: "requirement" } },
    ]),
  };
  const svc = new CharterAggregateService(goals as never, memories as never);
  const result = await svc.getCharter("p");
  expect(result.vision?.content).toBe("Be great");
  expect(result.goals).toHaveLength(1);
  expect(result.sections.requirement).toHaveLength(1);
  expect(result.sections.vision).toBeUndefined(); // vision surfaced separately
});
