import { describe, expect, it } from "vitest";
import { getAssignSkillOutcomeToast } from "./assign-skill-outcome-toast.helpers";

describe("getAssignSkillOutcomeToast", () => {
  it("reports auto-applied outcomes as a success toast", () => {
    expect(getAssignSkillOutcomeToast("auto_applied")).toEqual({
      kind: "success",
      title: "Skill assigned",
      description: "The assignment was applied immediately.",
    });
  });

  it("reports proposed outcomes as an info toast awaiting review", () => {
    expect(getAssignSkillOutcomeToast("proposed")).toEqual({
      kind: "info",
      title: "Proposal created",
      description: "The assignment is pending review in the queue.",
    });
  });

  it("reports dropped outcomes as a warning toast", () => {
    expect(getAssignSkillOutcomeToast("dropped")).toEqual({
      kind: "warning",
      title: "Proposal dropped",
      description: "Governance dropped this proposal before it was stored.",
    });
  });

  it("reports apply_failed outcomes as an error toast", () => {
    expect(getAssignSkillOutcomeToast("apply_failed")).toEqual({
      kind: "error",
      title: "Assignment failed to apply",
      description: "The proposal was recorded but could not be applied.",
    });
  });
});
