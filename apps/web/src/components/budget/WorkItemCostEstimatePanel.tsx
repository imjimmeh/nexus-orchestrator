import { Label } from "@/components/ui/label";
import { useWorkItemCostEstimate } from "@/hooks/useWorkItemCostEstimate";
import { formatCentsToDollars } from "./budget-format-utils";
import type { WorkItemCostEstimate as IWorkItemCostEstimate } from "@/lib/api/client.projects.types";

function EstimateSection({
  label,
  estimate,
  showWhatIf = false,
}: Readonly<{
  label: string;
  estimate?: IWorkItemCostEstimate;
  showWhatIf?: boolean;
}>) {
  if (!estimate || !estimate.available) {
    return (
      <div>
        <Label className="text-muted-foreground">{label}</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Not enough history yet to estimate this cost.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Label className="text-muted-foreground">{label}</Label>
      <p className="mt-1 text-lg font-medium">
        {estimate.estimatedCostCents === null
          ? "Pricing unavailable"
          : formatCentsToDollars(estimate.estimatedCostCents)}
      </p>
      {estimate.lowCostCents !== null && estimate.highCostCents !== null && (
        <p className="text-xs text-muted-foreground">
          Range: {formatCentsToDollars(estimate.lowCostCents)} -{" "}
          {formatCentsToDollars(estimate.highCostCents)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Based on {estimate.sampleCount} similar work item
        {estimate.sampleCount === 1 ? "" : "s"} ({estimate.bucketTier})
      </p>
      {showWhatIf && estimate.whatIf.length > 0 && (
        <div className="mt-2">
          <span className="text-xs text-muted-foreground block mb-1">
            Alternative Models:
          </span>
          <ul className="space-y-1 text-xs">
            {estimate.whatIf.map((row) => (
              <li
                key={row.modelId}
                className="flex justify-between gap-2 text-muted-foreground"
              >
                <span>{row.modelName}</span>
                <span className="tabular-nums">
                  {formatCentsToDollars(row.estimatedCostCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function WorkItemCostEstimatePanel({
  projectId,
  workItemId,
}: Readonly<{ projectId: string; workItemId: string }>) {
  const { data, isLoading } = useWorkItemCostEstimate(projectId, workItemId);

  if (isLoading || !data) {
    return null;
  }

  const currentStage = data.currentStage ?? data;
  const fullyImplement = data.fullyImplement;

  return (
    <div className="space-y-4">
      {data.projectedTotalCostCents !== undefined && (
        <div className="grid gap-3 rounded border p-3 sm:grid-cols-3">
          <div>
            <Label className="text-muted-foreground">Actual So Far</Label>
            <p className="mt-1 font-medium">
              {formatCentsToDollars(data.costCents ?? 0)}
            </p>
          </div>
          <div>
            <Label className="text-muted-foreground">Predicted Remaining</Label>
            <p className="mt-1 font-medium">
              {data.predictedRemainingCostCents === null
                ? "Not enough history"
                : formatCentsToDollars(data.predictedRemainingCostCents ?? 0)}
            </p>
          </div>
          <div>
            <Label className="text-muted-foreground">Projected Total</Label>
            <p className="mt-1 text-lg font-semibold">
              {data.projectedTotalCostCents === null
                ? "Not enough history"
                : formatCentsToDollars(data.projectedTotalCostCents)}
            </p>
            {data.lowProjectedTotalCostCents !== null &&
              data.lowProjectedTotalCostCents !== undefined &&
              data.highProjectedTotalCostCents !== null &&
              data.highProjectedTotalCostCents !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Projected range:{" "}
                  {formatCentsToDollars(data.lowProjectedTotalCostCents)} -{" "}
                  {formatCentsToDollars(data.highProjectedTotalCostCents)}
                </p>
              )}
          </div>
        </div>
      )}
      <EstimateSection label="Current Stage Cost" estimate={currentStage} />
      <EstimateSection
        label="Cost to Fully Implement"
        estimate={fullyImplement}
        showWhatIf
      />
    </div>
  );
}
