import { z } from "zod";
import type {
  CharterSection,
  ProjectMemoryCategory,
} from "./project-charter.schema.types";

export const PROJECT_MEMORY_CATEGORIES = [
  "vision",
  "requirement",
  "constraint",
  "do_dont",
  "non_goal",
  "success_criteria",
  "decision",
  "preference",
  "glossary",
  "stakeholder",
  "open_question",
] as const;

export type { ProjectMemoryCategory } from "./project-charter.schema.types";
export const ProjectMemoryCategorySchema = z.enum(PROJECT_MEMORY_CATEGORIES);

export const CHARTER_SECTIONS = [
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
] as const;
export type { CharterSection } from "./project-charter.schema.types";

// Single source of truth: section → memory category. 'Goals' is the only
// non-memory section (rendered from board goals), so it maps to null.
export const CHARTER_SECTION_TO_CATEGORY: Record<
  CharterSection,
  ProjectMemoryCategory | null
> = {
  Vision: "vision",
  Goals: null,
  Requirements: "requirement",
  Constraints: "constraint",
  "Dos & Don'ts": "do_dont",
  "Non-Goals": "non_goal",
  "Success Criteria": "success_criteria",
  Decisions: "decision",
  Preferences: "preference",
  Glossary: "glossary",
  Stakeholders: "stakeholder",
  "Open Questions": "open_question",
};

export const ProjectMemoryProvenanceSchema = z.object({
  category: ProjectMemoryCategorySchema,
  source: z.string(),
  captured_by: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type { ProjectMemoryProvenance } from "./project-charter.schema.types";
