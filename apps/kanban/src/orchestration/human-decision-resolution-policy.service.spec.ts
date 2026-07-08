import { beforeEach, describe, expect, it } from "vitest";
import { HumanDecisionResolutionPolicyService } from "./human-decision-resolution-policy.service";
import type {
  KanbanOrchestrationMode,
  HumanDecisionPolicy,
} from "./human-decision-resolution-policy.types";

describe("HumanDecisionResolutionPolicyService", () => {
  let service: HumanDecisionResolutionPolicyService;

  beforeEach(() => {
    service = new HumanDecisionResolutionPolicyService();
  });

  describe("selectPolicy", () => {
    it("autonomous mode defaults to decide_without_approval", () => {
      const policy = service.selectPolicy({
        orchestrationMode: "autonomous",
      });
      expect(policy).toBe("decide_without_approval");
    });

    it("supervised mode defaults to ask_when_uncertain", () => {
      const policy = service.selectPolicy({
        orchestrationMode: "supervised",
      });
      expect(policy).toBe("ask_when_uncertain");
    });

    it("notifications_only mode defaults to decide_without_approval", () => {
      const policy = service.selectPolicy({
        orchestrationMode: "notifications_only",
      });
      expect(policy).toBe("decide_without_approval");
    });

    it("explicit configured policy overrides mode default", () => {
      const policy = service.selectPolicy({
        orchestrationMode: "supervised",
        configuredPolicy: "always_supervise",
      });
      expect(policy).toBe("always_supervise");
    });
  });

  describe("resolve", () => {
    it("autonomous open question resolves without feedback gating", () => {
      const result = service.resolve({
        orchestrationMode: "autonomous",
        findingText: "Should this existing behavior be preserved?",
      });

      expect(result).toMatchObject({
        status: "todo" as const,
        workType: "gap" as const,
        policy: "decide_without_approval",
        autonomousDecision: true,
        feedbackNeeded: false,
      });

      expect(result.resolutionRationale).toBeDefined();
      const rationale = result.resolutionRationale ?? "";
      expect(rationale.toLowerCase()).toContain("autonomous");
      expect(result.resolutionRationale).toContain("without approval");
    });

    it("supervised open question resolves as feedback-needed", () => {
      const result = service.resolve({
        orchestrationMode: "supervised",
        findingText: "Should this existing behavior be preserved?",
      });

      expect(result).toMatchObject({
        status: "blocked" as const,
        workType: "human_decision" as const,
        policy: "ask_when_uncertain",
        autonomousDecision: false,
        feedbackNeeded: true,
      });

      expect(result.decisionPrompt).toContain(
        "Should this existing behavior be preserved?",
      );
    });

    it("notifications_only resolves without feedback gating", () => {
      const result = service.resolve({
        orchestrationMode: "notifications_only",
        findingText: "Should this existing behavior be preserved?",
      });

      expect(result).toMatchObject({
        status: "todo" as const,
        workType: "gap" as const,
        policy: "decide_without_approval",
        autonomousDecision: true,
        feedbackNeeded: false,
      });
    });

    it("always_supervise resolves as feedback-needed with decision prompt", () => {
      const result = service.resolve({
        orchestrationMode: "supervised",
        configuredPolicy: "always_supervise",
        findingText: "Missing deployment credentials.",
      });

      expect(result).toMatchObject({
        status: "blocked" as const,
        workType: "human_decision" as const,
        policy: "always_supervise",
        autonomousDecision: false,
        feedbackNeeded: true,
      });

      expect(result.decisionPrompt).toContain(
        "Missing deployment credentials.",
      );
      expect(result.resolutionRationale).toBeDefined();
    });

    it("always_supervise uses fallback prompt when findingText is absent", () => {
      const result = service.resolve({
        orchestrationMode: "supervised",
        configuredPolicy: "always_supervise",
      });

      expect(result.decisionPrompt).toBe(
        "Human review required for this finding.",
      );
    });
  });
});
