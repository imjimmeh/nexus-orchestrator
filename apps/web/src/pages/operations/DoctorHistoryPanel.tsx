import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { getApiErrorMessage } from "@/lib/api/error-message";
import { DoctorRepairHistoryPage } from "@/lib/api/doctor.types";
import {
  formatDateTime,
  getHistoryStatusBadgeVariant,
  readAutonomyHistoryContext,
  readHistoryMessage,
} from "./doctor.helpers";

export interface DoctorHistoryPanelProps {
  historyQuery: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: DoctorRepairHistoryPage;
  };
  historyLimit: number;
  historyOffset: number;
  setHistoryOffset: (offset: number) => void;
}

export function DoctorHistoryPanel(
  props: Readonly<DoctorHistoryPanelProps>,
): React.JSX.Element {
  const { historyQuery, historyLimit, historyOffset, setHistoryOffset } = props;
  const history = historyQuery.data;

  const canGoPrev = historyOffset > 0;
  const canGoNext = useMemo(() => {
    if (!history) {
      return false;
    }

    return history.offset + history.limit < history.total;
  }, [history]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repair History</CardTitle>
        <CardDescription>
          Audited doctor repair attempts with actor, mode, and outcomes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {historyQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading repair history...
          </div>
        )}

        {historyQuery.isError && (
          <p className="text-sm text-destructive">
            {getApiErrorMessage(
              historyQuery.error,
              "Failed to load repair history.",
            )}
          </p>
        )}

        {history && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.items.map((item) => {
                  const autonomyContext = readAutonomyHistoryContext(item);
                  const historyMessage = readHistoryMessage(item);

                  return (
                    <TableRow key={item.id}>
                      <TableCell>{formatDateTime(item.started_at)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.action_id}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getHistoryStatusBadgeVariant(item.status)}
                        >
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.dry_run ? "dry-run" : "live"}
                      </TableCell>
                      <TableCell>{item.requested_by ?? "-"}</TableCell>
                      <TableCell className="max-w-md" title={historyMessage}>
                        <div className="truncate">{historyMessage}</div>
                        {autonomyContext && (
                          <div className="truncate text-xs text-muted-foreground">
                            {autonomyContext}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {history.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-sm text-muted-foreground"
                    >
                      No repair history recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {history.offset + 1} -{" "}
                {Math.min(
                  history.offset + history.items.length,
                  history.total,
                )}{" "}
                of {history.total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setHistoryOffset(Math.max(0, historyOffset - historyLimit))
                  }
                  disabled={!canGoPrev}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHistoryOffset(historyOffset + historyLimit)}
                  disabled={!canGoNext}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
