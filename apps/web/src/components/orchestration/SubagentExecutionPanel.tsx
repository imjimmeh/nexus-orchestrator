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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { useSubagentExecutionRows } from "./SubagentExecutionPanel.hooks";
import { SubagentExecutionRow } from "./SubagentExecutionRow";

interface SubagentExecutionPanelProps {
  events: WorkflowTelemetryEvent[];
}

export function SubagentExecutionPanel({
  events,
}: Readonly<SubagentExecutionPanelProps>) {
  const rows = useSubagentExecutionRows(events);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subagent Observability</CardTitle>
          <CardDescription>
            No subagent events detected for this run.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subagent Observability</CardTitle>
        <CardDescription>
          Execution IDs, assigned files, overlap rejections, and wait
          aggregation summaries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Execution</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned Files</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <SubagentExecutionRow key={row.executionId} row={row} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
