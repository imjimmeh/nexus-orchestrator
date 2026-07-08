export type AssignSkillOutcomeToastKind =
  | "success"
  | "info"
  | "warning"
  | "error";

export interface AssignSkillOutcomeToast {
  kind: AssignSkillOutcomeToastKind;
  title: string;
  description: string;
}
