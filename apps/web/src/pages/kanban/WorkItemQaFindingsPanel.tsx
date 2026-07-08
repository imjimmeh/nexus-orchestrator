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

interface WorkItemQaFindingsPanelProps {
  item: WorkItem;
}

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

  return aliases.flatMap((entry) => {
    if (
      !entry ||
      typeof entry.deliverable_id !== "string" ||
      typeof entry.failure_type !== "string" ||
      typeof entry.details !== "string"
    ) {
      return [];
    }

    return [
      {
        ...entry,
        affected_files: Array.isArray(entry.affected_files)
          ? entry.affected_files.filter((file) => typeof file === "string")
          : [],
      },
    ];
  });
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

export function WorkItemQaFindingsPanel({
  item,
}: Readonly<WorkItemQaFindingsPanelProps>) {
  const rejection = parseRejectionFeedback(item);
  const rejectionCount = item.executionConfig?.rejectionCount;
  const failedDeliverables = readFailedDeliverables(rejection.structured);
  const hasUsefulFeedback =
    !!rejection.summary ||
    failedDeliverables.length > 0 ||
    (rejectionCount !== null && rejectionCount !== undefined);

  if (!hasUsefulFeedback) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>QA Review Findings</CardTitle>
        <CardDescription>
          Latest QA rejection feedback for this work item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rejection.summary && (
          <p className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
            {rejection.summary}
          </p>
        )}

        {rejectionCount !== null && rejectionCount !== undefined && (
          <p className="text-xs text-muted-foreground">
            Rejection count: {rejectionCount}
          </p>
        )}

        {failedDeliverables.length > 0 && (
          <div className="max-h-[260px] overflow-auto rounded-md border">
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
                {failedDeliverables.map((entry, index) => (
                  <TableRow
                    key={`${entry.deliverable_id}:${entry.failure_type}:${index}`}
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

        <p className="text-sm font-medium">
          Next step: Address failed deliverables before resubmitting.
        </p>
      </CardContent>
    </Card>
  );
}
