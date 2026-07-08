import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToolValidationRun } from "@/lib/api/tools.types";

interface ToolValidationRunsProps {
  runs: ToolValidationRun[];
  isLoading?: boolean;
}

function getRunStatusVariant(status: ToolValidationRun["status"]) {
  if (status === "passed") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function ToolValidationRuns({
  runs,
  isLoading = false,
}: Readonly<ToolValidationRunsProps>) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Stdout</TableHead>
            <TableHead>Stderr</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center">
                Loading validation runs...
              </TableCell>
            </TableRow>
          ) : runs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center">
                No validation runs yet
              </TableCell>
            </TableRow>
          ) : (
            runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <Badge variant={getRunStatusVariant(run.status)}>
                    {run.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {run.duration_ms ? `${run.duration_ms} ms` : "-"}
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <pre className="max-h-32 overflow-auto text-xs whitespace-pre-wrap">
                    {run.stdout || "-"}
                  </pre>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <pre className="max-h-32 overflow-auto text-xs whitespace-pre-wrap">
                    {run.stderr || "-"}
                  </pre>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
