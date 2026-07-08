import { Badge } from "@/components/ui/badge";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { formatDateSafe } from "@/lib/utils";
import type { SubagentExecutionRow as SubagentExecutionRowData } from "./SubagentExecutionPanel.types";

type SubagentRowVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

function getStatusVariant(status: string): SubagentRowVariant {
  const normalized = status.toLowerCase();

  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "rejected"
  ) {
    return "destructive";
  }

  if (normalized === "completed" || normalized === "success") {
    return "secondary";
  }

  if (
    normalized === "running" ||
    normalized === "started" ||
    normalized === "pending"
  ) {
    return "default";
  }

  return "outline";
}

interface SubagentExecutionRowProps {
  row: SubagentExecutionRowData;
}

export function SubagentExecutionRow({
  row,
}: Readonly<SubagentExecutionRowProps>) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        {row.executionId}
      </TableCell>
      <TableCell>
        <Badge variant={getStatusVariant(row.status)}>
          {row.status}
        </Badge>
      </TableCell>
      <TableCell>
        {row.assignedFiles.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.assignedFiles.map((path) => (
              <Badge key={path} variant="outline">
                {path}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
        {row.overlapError && (
          <p className="mt-1 text-xs text-destructive">
            {row.overlapError}
          </p>
        )}
        {row.waitSummary && !row.overlapError && (
          <p className="mt-1 text-xs text-muted-foreground">
            {row.waitSummary}
          </p>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.startedAt
          ? formatDateSafe(row.startedAt, "MMM d, HH:mm:ss", "-")
          : "-"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.completedAt
          ? formatDateSafe(row.completedAt, "MMM d, HH:mm:ss", "-")
          : "-"}
      </TableCell>
    </TableRow>
  );
}