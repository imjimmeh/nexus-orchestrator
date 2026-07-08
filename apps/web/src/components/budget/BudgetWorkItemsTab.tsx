import { useWorkItemCostSummary } from "@/hooks/useWorkItemCostSummary";
import { formatCentsToDollars, formatTokens } from "./budget-format-utils";

export function BudgetWorkItemsTab() {
  const { data: items = [], isLoading } = useWorkItemCostSummary({ limit: 20 });

  if (isLoading) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Loading work item cost summary...
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No work items with accrued cost yet.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Work Item</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 text-right font-medium">Tokens</th>
            <th className="pb-2 text-right font-medium">Actual So Far</th>
            <th className="pb-2 text-right font-medium">Predicted Remaining</th>
            <th className="pb-2 text-right font-medium">Projected Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <span className="font-medium">{item.title}</span>
              </td>
              <td className="py-2 pr-4">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {item.status}
                </span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {formatTokens(item.tokenSpend)}
              </td>
              <td className="py-2 text-right tabular-nums font-medium">
                {formatCentsToDollars(item.costCents)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {item.predictedRemainingCostCents !== null
                  ? formatCentsToDollars(item.predictedRemainingCostCents)
                  : "-"}
              </td>
              <td className="py-2 text-right tabular-nums font-semibold">
                {item.projectedTotalCostCents !== null
                  ? formatCentsToDollars(item.projectedTotalCostCents)
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
