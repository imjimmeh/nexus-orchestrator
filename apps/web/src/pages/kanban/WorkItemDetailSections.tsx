import { useEffect, useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseDecisionMetadata } from "./kanban-card-ui";

export function AssignedAgentSection({
  assignedAgentId,
}: Readonly<{
  assignedAgentId?: string | null;
}>) {
  if (!assignedAgentId) {
    return null;
  }

  return (
    <div>
      <Label className="text-muted-foreground">Assigned Agent</Label>
      <p className="mt-1 text-sm">{assignedAgentId}</p>
    </div>
  );
}

export function ExecutionIdSection({
  executionId,
  workflowRunStatusContent,
}: Readonly<{
  executionId?: string | null;
  workflowRunStatusContent: ReactNode;
}>) {
  if (!executionId) {
    return null;
  }

  return (
    <div>
      <Label className="text-muted-foreground">Execution ID</Label>
      <p className="mt-1 text-sm font-mono">{executionId}</p>
      <div className="mt-2">{workflowRunStatusContent}</div>
    </div>
  );
}

export function MergeStatusSection({
  mergeStatus,
  mergeReason,
}: Readonly<{
  mergeStatus: string | null;
  mergeReason: string | null;
}>) {
  if (!mergeStatus) {
    return null;
  }

  return (
    <div>
      <Label className="text-muted-foreground">Merge Status</Label>
      <div className="mt-1">
        <Badge variant={mergeStatus === "failed" ? "destructive" : "secondary"}>
          {mergeStatus}
        </Badge>
      </div>
      {mergeReason && (
        <p className="mt-2 text-xs text-muted-foreground">{mergeReason}</p>
      )}
    </div>
  );
}

function FeedbackDecisionSection(
  props: Readonly<{
    feedbackNeeded: boolean;
    decisionPrompt: string | null;
    onResolveFeedback?: (response: string) => void;
  }>,
): ReactNode {
  const resolutionFieldId = useId();
  const [response, setResponse] = useState("");

  useEffect(() => {
    setResponse("");
  }, [props.decisionPrompt, props.feedbackNeeded]);

  if (!props.feedbackNeeded || !props.decisionPrompt) {
    return null;
  }

  const trimmedResponse = response.trim();

  return (
    <div>
      <Badge variant="outline" className="mb-1">
        Feedback needed
      </Badge>
      <p className="text-xs text-muted-foreground">{props.decisionPrompt}</p>
      {props.onResolveFeedback ? (
        <div className="mt-3 space-y-2">
          <div>
            <Label htmlFor={resolutionFieldId}>Resolution</Label>
            <Textarea
              id={resolutionFieldId}
              value={response}
              onChange={(event) => {
                setResponse(event.target.value);
              }}
              placeholder="Describe the decision or direction to continue with."
              className="mt-1 min-h-24"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={trimmedResponse.length === 0}
            onClick={() => {
              props.onResolveFeedback?.(trimmedResponse);
            }}
          >
            Submit Feedback and Continue
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function renderAutonomousDecision(params: {
  autonomousDecision: boolean;
  resolutionRationale: string | null;
}): ReactNode {
  if (!params.autonomousDecision || !params.resolutionRationale) {
    return null;
  }

  return (
    <div>
      <Badge variant="secondary" className="mb-1">
        Autonomous decision
      </Badge>
      <p className="text-xs text-muted-foreground">
        {params.resolutionRationale}
      </p>
    </div>
  );
}

function renderOverrideDecision(params: {
  userStatusOverride: boolean;
  generatedRecommendation: string | null;
}): ReactNode {
  if (!params.userStatusOverride || !params.generatedRecommendation) {
    return null;
  }

  return (
    <div>
      <Badge variant="outline" className="mb-1">
        Generated recommendation: {params.generatedRecommendation}
      </Badge>
      <p className="text-xs text-muted-foreground">
        Your current status is preserved
      </p>
    </div>
  );
}

function renderResolvedHumanFeedback(params: {
  humanDecisionResponse: string | null;
  humanDecisionResolvedBy: string | null;
  humanDecisionResolvedAt: string | null;
}): ReactNode {
  if (!params.humanDecisionResponse) {
    return null;
  }

  return (
    <div>
      <Badge variant="secondary" className="mb-1">
        Human feedback recorded
      </Badge>
      <p className="text-xs text-muted-foreground">
        {params.humanDecisionResponse}
      </p>
      {params.humanDecisionResolvedBy || params.humanDecisionResolvedAt ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {params.humanDecisionResolvedBy ?? "Unknown reviewer"}
          {params.humanDecisionResolvedAt
            ? ` · ${new Date(params.humanDecisionResolvedAt).toLocaleString()}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

export function DecisionMetadataSection({
  metadata,
  onResolveFeedback,
}: Readonly<{
  metadata: Record<string, unknown> | null | undefined;
  onResolveFeedback?: (response: string) => void;
}>) {
  const decision = parseDecisionMetadata(metadata);
  if (!decision) {
    return null;
  }

  const hasFeedbackSection =
    decision.feedbackNeeded && decision.decisionPrompt !== null;
  const feedbackSection = hasFeedbackSection ? (
    <FeedbackDecisionSection
      feedbackNeeded={decision.feedbackNeeded}
      decisionPrompt={decision.decisionPrompt}
      onResolveFeedback={onResolveFeedback}
    />
  ) : null;
  const autonomousSection = renderAutonomousDecision({
    autonomousDecision: decision.autonomousDecision,
    resolutionRationale: decision.resolutionRationale,
  });
  const overrideSection = renderOverrideDecision({
    userStatusOverride: decision.userStatusOverride,
    generatedRecommendation: decision.generatedRecommendation,
  });
  const resolvedHumanFeedbackSection = renderResolvedHumanFeedback({
    humanDecisionResponse: decision.humanDecisionResponse,
    humanDecisionResolvedBy: decision.humanDecisionResolvedBy,
    humanDecisionResolvedAt: decision.humanDecisionResolvedAt,
  });

  if (
    !feedbackSection &&
    !autonomousSection &&
    !overrideSection &&
    !resolvedHumanFeedbackSection
  ) {
    return null;
  }

  return (
    <div>
      <Label className="text-muted-foreground">Decision Policy</Label>
      <div className="mt-1 space-y-2 text-sm">
        {feedbackSection}
        {autonomousSection}
        {resolvedHumanFeedbackSection}
        {overrideSection}
      </div>
    </div>
  );
}
