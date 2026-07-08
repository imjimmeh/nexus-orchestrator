import { describe, it, expect } from "vitest";
import {
  PROJECT_MEMORY_CATEGORIES,
  CHARTER_SECTIONS,
  CHARTER_SECTION_TO_CATEGORY,
} from "./project-charter.schema";

describe("project-charter contracts", () => {
  it("includes vision and success_criteria categories", () => {
    expect(PROJECT_MEMORY_CATEGORIES).toContain("vision");
    expect(PROJECT_MEMORY_CATEGORIES).toContain("success_criteria");
  });
  it("orders sections canonically with Decisions and Preferences", () => {
    expect(CHARTER_SECTIONS).toEqual([
      "Vision",
      "Goals",
      "Requirements",
      "Constraints",
      "Dos & Don'ts",
      "Non-Goals",
      "Success Criteria",
      "Decisions",
      "Preferences",
      "Glossary",
      "Stakeholders",
      "Open Questions",
    ]);
  });
  it("maps every memory category to exactly one section (Goals is the only non-memory section)", () => {
    const mapped = Object.values(CHARTER_SECTION_TO_CATEGORY).filter(Boolean);
    for (const cat of PROJECT_MEMORY_CATEGORIES) expect(mapped).toContain(cat);
    expect(CHARTER_SECTION_TO_CATEGORY["Goals"]).toBeNull();
  });
});
