import { Loader2, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { LifecycleResumeSummary } from "@/lib/api/doctor.types";
import { formatDateTime } from "./doctor.helpers";

interface ResumeSummaryPanelProps {
  resumeQuery: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: LifecycleResumeSummary;
  };
}

export function ResumeSummaryPanel(props: Readonly<ResumeSummaryPanelProps>) {
  const { resumeQuery } = props;
  const summary = resumeQuery.data;
  // StartupResumeCoordinator always stamps lastResumeAt at the end of every
  // startup pass, so a non-null timestamp alone does not imply a resume
  // occurred. Only treat it as a resume when frozen executions were found.
  const startupCompleted =
    summary !== undefined && summary.lastResumeAt !== null;
  const hasResumed = startupCompleted && summary.frozenFound > 0;
  const cleanRestart = startupCompleted && summary.frozenFound === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCcw className="h-5 w-5" />
          Last Restart Resume
        </CardTitle>
        <CardDescription>
          Executions frozen on shutdown and resumed on the most recent service
          restart.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resumeQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading resume summary...
          </div>
        )}

        {resumeQuery.isError && (
          <p className="text-sm text-destructive">
            {getApiErrorMessage(
              resumeQuery.error,
              "Failed to load resume summary.",
            )}
          </p>
        )}

        {summary && !resumeQuery.isError && cleanRestart && (
          <p className="text-sm text-muted-foreground">
            No executions were resumed on the last restart.
          </p>
        )}

        {summary && hasResumed && summary.lastResumeAt !== null && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={summary.failed > 0 ? "destructive" : "default"}>
              {summary.resumed}/{summary.frozenFound} resumed
            </Badge>
            <span className="text-muted-foreground">
              {summary.failed} failed
            </span>
            <span className="text-xs text-muted-foreground">
              Last restart {formatDateTime(summary.lastResumeAt)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
