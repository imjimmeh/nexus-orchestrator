/**
 * Policy enum for human decision resolution in the kanban orchestration module.
 *
 * The policy controls whether open questions and human-decision findings are
 * resolved automatically or require human feedback.
 */
export type HumanDecisionPolicy =
  | "decide_without_approval"
  | "ask_when_uncertain"
  | "always_supervise";

/**
 * Orchestration mode supported by the kanban application layer.
 *
 * Extended beyond `@nexus/kanban-contracts` `OrchestrationMode` (which only
 * covers `"supervised" | "autonomous"`) to include `"notifications_only"` for
 * read-only orchestration runs that should not block execution.
 */
export type KanbanOrchestrationMode =
  | "autonomous"
  | "supervised"
  | "notifications_only";

export interface HumanDecisionPolicyInput {
  orchestrationMode: KanbanOrchestrationMode;
  configuredPolicy?: HumanDecisionPolicy;
  findingText?: string;
}

export interface HumanDecisionResolutionResult {
  status: "todo" | "blocked";
  workType: "gap" | "human_decision";
  policy: HumanDecisionPolicy;
  autonomousDecision: boolean;
  feedbackNeeded: boolean;
  resolutionRationale?: string;
  decisionPrompt?: string;
  lastGeneratedStatus: "todo" | "blocked";
  generatedRecommendation: "todo" | "blocked";
}
