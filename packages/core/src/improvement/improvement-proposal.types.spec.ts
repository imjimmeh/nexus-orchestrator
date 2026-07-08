import { describe, expect, it } from "vitest";
import {
  IMPROVEMENT_PROPOSAL_KINDS,
  IMPROVEMENT_PROPOSAL_STATUSES,
  GOVERNANCE_MODES,
} from "./improvement-proposal.types";

describe("improvement proposal type constants", () => {
  it("enumerates the five proposal kinds", () => {
    expect([...IMPROVEMENT_PROPOSAL_KINDS]).toEqual([
      "skill_create",
      "skill_assignment",
      "workflow_definition_change",
      "agent_profile_change",
      "code_change",
    ]);
  });

  it("enumerates the six statuses", () => {
    expect([...IMPROVEMENT_PROPOSAL_STATUSES]).toEqual([
      "pending",
      "approved",
      "rejected",
      "applied",
      "failed",
      "rolled_back",
    ]);
  });

  it("enumerates the three governance modes", () => {
    expect([...GOVERNANCE_MODES]).toEqual(["tiered", "manual", "autonomous"]);
  });
});
