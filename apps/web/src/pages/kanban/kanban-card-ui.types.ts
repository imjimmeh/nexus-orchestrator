export interface DecisionMetadata {
  feedbackNeeded: boolean;
  decisionPrompt: string | null;
  autonomousDecision: boolean;
  resolutionRationale: string | null;
  humanDecisionResponse: string | null;
  humanDecisionResolvedBy: string | null;
  humanDecisionResolvedAt: string | null;
  userStatusOverride: boolean;
  generatedRecommendation: string | null;
  currentDisposition: string | null;
  lastGeneratedStatus: string | null;
}
