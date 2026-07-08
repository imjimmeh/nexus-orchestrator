import { Bot, MessageCircleQuestion, ShieldAlert } from "lucide-react";
import type { DecisionMetadata } from "./kanban-card-ui.types";

interface KanbanWorkItemDecisionMetadataBannersProps {
  decisionMetadata: DecisionMetadata | null;
}

export function KanbanWorkItemDecisionMetadataBanners({
  decisionMetadata,
}: Readonly<KanbanWorkItemDecisionMetadataBannersProps>) {
  return (
    <>
      {decisionMetadata?.feedbackNeeded && decisionMetadata.decisionPrompt ? (
        <div className="mt-2 rounded bg-warning/15 px-2 py-1 text-xs text-warning">
          <span className="inline-flex items-center gap-1 font-medium">
            <MessageCircleQuestion className="h-3 w-3" />
            Feedback needed
          </span>
          <p className="mt-0.5">{decisionMetadata.decisionPrompt}</p>
        </div>
      ) : null}

      {decisionMetadata?.autonomousDecision &&
      decisionMetadata.resolutionRationale ? (
        <div className="mt-2 rounded bg-info/15 px-2 py-1 text-xs text-info">
          <span className="inline-flex items-center gap-1 font-medium">
            <Bot className="h-3 w-3" />
            Autonomous decision
          </span>
          <p className="mt-0.5">{decisionMetadata.resolutionRationale}</p>
        </div>
      ) : null}

      {decisionMetadata?.userStatusOverride &&
      decisionMetadata.generatedRecommendation ? (
        <div className="mt-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium">
            <ShieldAlert className="h-3 w-3" />
            Generated recommendation: {decisionMetadata.generatedRecommendation}
          </span>
          <p className="mt-0.5">Your current status is preserved</p>
        </div>
      ) : null}
    </>
  );
}
