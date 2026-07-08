import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { asRecord, readString } from "@/lib/deep-paths";
import { sanitizeQaDisplayText } from "@/lib/qa-display-sanitization";
import { WorkItem, WorkItemFailedDeliverable, WorkItemRejectionFeedback } from "@/lib/api/work-items.types";
import { WorkItemTypeBadge } from "@/features/kanban/work-item-type-badge";

function readFailedDeliverables(
  feedback: WorkItemRejectionFeedback | null,
): WorkItemFailedDeliverable[] {
  if (!feedback) {
    return [];
  }

  const aliases = feedback.failedDeliverables ?? feedback.failed_deliverables;
  if (!Array.isArray(aliases)) {
    return [];
  }

  return aliases.filter(
    (entry): entry is WorkItemFailedDeliverable =>
      !!entry &&
      typeof entry.deliverable_id === "string" &&
      typeof entry.details === "string",
  );
}

function parseRejectionFeedback(item: WorkItem): {
  summary: string | null;
  structured: WorkItemRejectionFeedback | null;
} {
  const value = item.executionConfig?.rejectionFeedback;
  if (!value) {
    return { summary: null, structured: null };
  }

  if (typeof value === "string") {
    const summary = readString(value);
    return {
      summary: summary ? sanitizeQaDisplayText(summary) : null,
      structured: null,
    };
  }

  const record = asRecord(value);
  if (!record) {
    return { summary: null, structured: null };
  }

  const summaryValue =
    readString(record.feedback) ||
    readString(record.message) ||
    readString(record.reason) ||
    null;

  return {
    summary: summaryValue ? sanitizeQaDisplayText(summaryValue) : null,
    structured: value,
  };
}

function getPlanState(
  item: WorkItem,
): "not planned" | "planned" | "delta replan required" {
  const hasPlan = !!item.executionConfig?.implementationPlan;
  const hasRejection = !!item.executionConfig?.rejectionFeedback;

  if (hasPlan && hasRejection) {
    return "delta replan required";
  }

  if (hasPlan) {
    return "planned";
  }

  return "not planned";
}

function getPlanStateVariant(
  state: "not planned" | "planned" | "delta replan required",
) {
  if (state === "delta replan required") {
    return "destructive" as const;
  }

  if (state === "planned") {
    return "secondary" as const;
  }

  return "outline" as const;
}

interface PlanReviewPanelProps {
  item: WorkItem;
}

export function PlanReviewPanel({ item }: Readonly<PlanReviewPanelProps>) {
  const planState = getPlanState(item);
  const plan = item.executionConfig?.implementationPlan;
  const rejection = parseRejectionFeedback(item);
  const failedDeliverables = readFailedDeliverables(rejection.structured);
  const rejectionCount = item.executionConfig?.rejectionCount ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Plan and Review
          <Badge variant={getPlanStateVariant(planState)}>{planState}</Badge>
          <WorkItemTypeBadge type={item.type} />
        </CardTitle>
        <CardDescription>
          Items with a recorded implementation plan expose it here alongside
          structured review feedback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {planState === "delta replan required" && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Only failed deliverables will be re-planned and re-implemented.
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Implementation Plan
          </p>
          {plan ? (
            <pre className="max-h-[240px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
              {sanitizeQaDisplayText(JSON.stringify(plan, null, 2))}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No implementation plan recorded.
            </p>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Latest Reviewer Feedback
          </p>
          {rejection.summary ? (
            <p className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
              {rejection.summary}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No rejection feedback recorded.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Rejection count: {rejectionCount}
          </p>
        </div>

        {failedDeliverables.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Failed Deliverables
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deliverable</TableHead>
                  <TableHead>Failure Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Affected Files</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedDeliverables.map((entry) => (
                  <TableRow
                    key={`${entry.deliverable_id}:${entry.failure_type}`}
                  >
                    <TableCell className="font-mono text-xs">
                      {entry.deliverable_id}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.failure_type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {sanitizeQaDisplayText(entry.details)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(entry.affected_files ?? []).map((file) => (
                          <Badge key={file} variant="secondary">
                            {file}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
