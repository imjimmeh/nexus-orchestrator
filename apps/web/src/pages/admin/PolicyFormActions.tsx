import { Button } from "@/components/ui/button";
import type { BudgetPolicy } from "@/lib/api/client.budget.types";

interface PolicyFormActionsProps {
  policy: BudgetPolicy | undefined;
  isSubmitting: boolean;
  onCancel: () => void;
}

function resolveSubmitLabel(
  policy: BudgetPolicy | undefined,
  isSubmitting: boolean,
): string {
  if (isSubmitting) {
    return "Saving...";
  }
  return policy ? "Update" : "Create";
}

export function PolicyFormActions({
  policy,
  isSubmitting,
  onCancel,
}: Readonly<PolicyFormActionsProps>) {
  const submitLabel = resolveSubmitLabel(policy, isSubmitting);
  return (
    <div className="flex justify-end gap-2 pt-4">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {submitLabel}
      </Button>
    </div>
  );
}
