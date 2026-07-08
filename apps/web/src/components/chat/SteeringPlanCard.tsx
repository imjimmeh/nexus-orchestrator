import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SteeringPlan } from "@/lib/api/steering.types";

export type { SteeringPlan, SteeringProposedChange } from "@/lib/api/steering.types";

const LEGACY_CORE_STEERING_CHANGE_TYPES = new Set(["amend_entity"]);

export interface SteeringPlanCardProps {
  plan: SteeringPlan;
  onApprove: () => void;
  onModify: () => void;
  onReject: () => void;
  onClarify?: (question: string) => void;
  disabled?: boolean;
}

function getIntentLabel(intent: string): string {
  const labels: Record<string, string> = {
    add_feature: "Add Feature",
    modify_feature: "Modify Feature",
    refactor: "Refactor",
    investigate: "Investigate",
    create_spec: "Create Spec",
    update_spec: "Update Spec",
    fix_bug: "Fix Bug",
    remove_feature: "Remove Feature",
  };
  return labels[intent] ?? intent;
}

function getChangeTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    update_artifact: "\u{1F4DD}",
    create_work_item: "\u{1F3AB}",
    update_work_item: "\u{270F}\u{FE0F}",
    invoke_workflow: "\u{2699}\u{FE0F}",
  };
  return icons[type] ?? "\u{1F4CB}";
}

function getConfidenceVariant(
  confidence: number,
): "default" | "secondary" | "destructive" | "outline" {
  if (confidence >= 0.8) return "default";
  if (confidence >= 0.6) return "secondary";
  return "destructive";
}

export function SteeringPlanCard({
  plan,
  onApprove,
  onModify,
  onReject,
  onClarify,
  disabled = false,
}: Readonly<SteeringPlanCardProps>) {
  const supportedChanges = plan.proposed_changes.filter(
    (change) => !LEGACY_CORE_STEERING_CHANGE_TYPES.has(change.type),
  );
  const hiddenLegacyChangeCount =
    plan.proposed_changes.length - supportedChanges.length;

  return (
    <Card className="my-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          Steering Plan
          <Badge variant={getConfidenceVariant(plan.confidence)}>
            {getIntentLabel(plan.intent)}
          </Badge>
          <Badge variant="outline">
            {Math.round(plan.confidence * 100)}% confidence
          </Badge>
          <Badge variant="secondary">{plan.target_area}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{plan.description}</p>

        {supportedChanges.length > 0 && (
          <div>
            <p className="mb-1 font-medium">Proposed Changes:</p>
            <ul className="list-none space-y-1 pl-0">
              {supportedChanges.map((change, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-base leading-5">
                    {getChangeTypeIcon(change.type)}
                  </span>
                  <div>
                    <span className="font-medium">
                      {change.type.replace(/_/g, " ")}:
                    </span>{" "}
                    {change.description}
                    {change.entity_type && (
                      <span className="ml-1 text-muted-foreground">
                        ({change.entity_type})
                      </span>
                    )}
                    {change.workflow_name && (
                      <span className="ml-1 text-muted-foreground">
                        [{change.workflow_name}]
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hiddenLegacyChangeCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Unsupported legacy steering action hidden.
          </p>
        )}

        {plan.context_summary && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{plan.context_summary.work_item_count} work items</span>
            <span>{plan.context_summary.active_work_items} active</span>
            <span>
              {plan.context_summary.has_artifacts ? "Has specs" : "No specs"}
            </span>
            <span>{plan.context_summary.recent_commits} recent commits</span>
          </div>
        )}

        {plan.questions_for_user.length > 0 && onClarify && (
          <div>
            <p className="mb-1 font-medium">Questions:</p>
            {plan.questions_for_user.map((q, i) => (
              <button
                key={i}
                type="button"
                className="mb-1 block text-left text-primary hover:underline"
                onClick={() => onClarify(q)}
                disabled={disabled}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={onApprove} disabled={disabled}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onModify}
            disabled={disabled}
          >
            Modify
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onReject}
            disabled={disabled}
          >
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
