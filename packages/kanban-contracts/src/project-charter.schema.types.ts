// packages/kanban-contracts/src/project-charter.schema.types.ts

export type ProjectMemoryCategory =
  | "vision"
  | "requirement"
  | "constraint"
  | "do_dont"
  | "non_goal"
  | "success_criteria"
  | "decision"
  | "preference"
  | "glossary"
  | "stakeholder"
  | "open_question";

export type CharterSection =
  | "Vision"
  | "Goals"
  | "Requirements"
  | "Constraints"
  | "Dos & Don'ts"
  | "Non-Goals"
  | "Success Criteria"
  | "Decisions"
  | "Preferences"
  | "Glossary"
  | "Stakeholders"
  | "Open Questions";

export interface ProjectMemoryProvenance {
  category: ProjectMemoryCategory;
  source: string;
  captured_by?: string;
  confidence?: number;
}
