import { AlertTriangle, Ban, DollarSign, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type BudgetDecision =
  | "allow"
  | "warn"
  | "approval_required"
  | "throttle"
  | "deny";

export interface BudgetStatusBannerProps {
  decision: BudgetDecision;
  reasonCode?: string | null;
  estimatedCostCents?: number | null;
  remainingBudgetCents?: number | null;
}

function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

function resolveAlertClass(decision: BudgetDecision): string {
  switch (decision) {
    case "warn":
      return "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100";
    case "approval_required":
      return "border-info/30 bg-info/10 text-info-foreground dark:border-info/50 dark:bg-info/20";
    case "deny":
    case "throttle":
      return "border-destructive/30 bg-destructive/10 text-destructive-foreground dark:border-destructive/50 dark:bg-destructive/20";
    default:
      return "";
  }
}

function resolveVariant(decision: BudgetDecision): "default" | "destructive" {
  if (decision === "deny" || decision === "throttle") {
    return "destructive";
  }
  return "default";
}

function resolveTitle(decision: BudgetDecision): string {
  switch (decision) {
    case "warn":
      return "Budget Warning";
    case "approval_required":
      return "Budget Approval Required";
    case "throttle":
      return "Budget Throttled";
    case "deny":
      return "Budget Exceeded";
    default:
      return "";
  }
}

function resolveMessage(
  decision: BudgetDecision,
  reasonCode?: string | null,
): string {
  switch (decision) {
    case "warn":
      return "You are approaching your budget limit. Consider reviewing usage before proceeding.";
    case "approval_required":
      return reasonCode
        ? `Additional approval is needed to continue (${reasonCode}).`
        : "Additional approval is needed to continue.";
    case "throttle":
      return "Execution has been throttled to stay within budget limits.";
    case "deny":
      return reasonCode
        ? `Execution has been blocked due to budget constraints (${reasonCode}).`
        : "Execution has been blocked due to budget constraints.";
    default:
      return "";
  }
}

function resolveIcon(decision: BudgetDecision) {
  switch (decision) {
    case "warn":
      return (
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
      );
    case "approval_required":
      return <Info className="h-4 w-4 text-info" />;
    case "throttle":
    case "deny":
      return <Ban className="h-4 w-4 text-destructive" />;
    default:
      return <DollarSign className="h-4 w-4" />;
  }
}

export function BudgetStatusBanner({
  decision,
  reasonCode,
  estimatedCostCents,
  remainingBudgetCents,
}: Readonly<BudgetStatusBannerProps>) {
  if (decision === "allow") {
    return null;
  }

  const title = resolveTitle(decision);
  const message = resolveMessage(decision, reasonCode);
  const Icon = resolveIcon(decision);
  const variant = resolveVariant(decision);
  const alertClass = resolveAlertClass(decision);
  const hasCostInfo =
    (estimatedCostCents !== null && estimatedCostCents !== undefined) ||
    (remainingBudgetCents !== null && remainingBudgetCents !== undefined);

  return (
    <Alert variant={variant} className={alertClass}>
      {Icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{message}</p>
        {hasCostInfo ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {estimatedCostCents !== null && estimatedCostCents !== undefined ? (
              <span>Estimated cost: {formatCents(estimatedCostCents)}</span>
            ) : null}
            {remainingBudgetCents !== null &&
            remainingBudgetCents !== undefined ? (
              <span>Remaining budget: {formatCents(remainingBudgetCents)}</span>
            ) : null}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
