import { Injectable } from "@nestjs/common";
import {
  type HumanDecisionPolicy,
  type HumanDecisionPolicyInput,
  type HumanDecisionResolutionResult,
  type KanbanOrchestrationMode,
} from "./human-decision-resolution-policy.types";

export type {
  HumanDecisionPolicy,
  HumanDecisionPolicyInput,
  HumanDecisionResolutionResult,
  KanbanOrchestrationMode,
};

/**
 * Resolves human decision findings using an orchestration-mode-aware policy.
 */
@Injectable()
export class HumanDecisionResolutionPolicyService {
  selectPolicy(input: HumanDecisionPolicyInput): HumanDecisionPolicy {
    if (input.configuredPolicy) {
      return input.configuredPolicy;
    }

    switch (input.orchestrationMode) {
      case "autonomous":
        return "decide_without_approval";
      case "supervised":
        return "ask_when_uncertain";
      case "notifications_only":
        return "decide_without_approval";
      default:
        return "ask_when_uncertain";
    }
  }

  resolve(input: HumanDecisionPolicyInput): HumanDecisionResolutionResult {
    const policy = this.selectPolicy(input);

    if (policy === "decide_without_approval") {
      return {
        status: "todo",
        workType: "gap",
        policy,
        autonomousDecision: true,
        feedbackNeeded: false,
        resolutionRationale:
          "Autonomous mode decided without approval. This finding has been converted into actionable work.",
        lastGeneratedStatus: "todo",
        generatedRecommendation: "todo",
      };
    }

    const decisionPrompt = input.findingText
      ? `Review required: ${input.findingText}`
      : "Human review required for this finding.";

    return {
      status: "blocked",
      workType: "human_decision",
      policy,
      autonomousDecision: false,
      feedbackNeeded: true,
      decisionPrompt,
      resolutionRationale:
        "Supervised mode requires human feedback before resolution.",
      lastGeneratedStatus: "blocked",
      generatedRecommendation: "blocked",
    };
  }
}
