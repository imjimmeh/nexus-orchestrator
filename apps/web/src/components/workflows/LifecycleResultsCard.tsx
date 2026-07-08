import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkflowLifecycleResults } from "@/hooks/useWorkflows";
import { WorkflowLifecycleResultsQuery } from "@/lib/api/workflow-lifecycle.types";

interface LifecycleResultsCardProps {
  readonly query: WorkflowLifecycleResultsQuery;
}

export function LifecycleResultsCard({ query }: LifecycleResultsCardProps) {
  const lifecycleResults = useWorkflowLifecycleResults(query);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle Results</CardTitle>
      </CardHeader>
      <CardContent>
        {lifecycleResults.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading lifecycle results...
          </p>
        ) : lifecycleResults.isError ? (
          <p className="text-sm text-destructive">
            Unable to load lifecycle results.
          </p>
        ) : (lifecycleResults.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lifecycle results recorded
          </p>
        ) : (
          <div className="space-y-4">
            {(lifecycleResults.data ?? []).map((result) => (
              <div key={result.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">{result.aggregate_status}</Badge>
                  <span>{result.phase}</span>
                  <span className="text-muted-foreground">{result.hook}</span>
                  <Badge
                    variant={result.blocking_only ? "secondary" : "outline"}
                  >
                    {result.blocking_only ? "blocking" : "non-blocking"}
                  </Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Hook</TableHead>
                      <TableHead>Blocking</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.results.map((workflowResult) => (
                      <TableRow
                        key={`${result.id}-${workflowResult.workflowId}`}
                      >
                        <TableCell>{workflowResult.workflowName}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {workflowResult.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{workflowResult.hook}</TableCell>
                        <TableCell>
                          {workflowResult.blocking
                            ? "blocking"
                            : "non-blocking"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
