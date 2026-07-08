import { Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { DoctorRepairActionId, DoctorReportEnvelope } from "@/lib/api/doctor.types";
import {
  formatDateTime,
  getStatusBadgeVariant,
} from "./doctor.helpers";

export interface DoctorReportPanelProps {
  reportQuery: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: DoctorReportEnvelope;
  };
  argumentsByAction: Record<DoctorRepairActionId, string>;
  setActionArguments: (actionId: DoctorRepairActionId, value: string) => void;
  onRunDryRepair: (actionId: DoctorRepairActionId, checkId: string) => void;
  onRunLiveRepair: (actionId: DoctorRepairActionId, checkId: string) => void;
  repairPending: boolean;
}

export function DoctorReportPanel(
  props: Readonly<DoctorReportPanelProps>,
): React.JSX.Element {
  const {
    reportQuery,
    argumentsByAction,
    setActionArguments,
    onRunDryRepair,
    onRunLiveRepair,
    repairPending,
  } = props;

  const report = reportQuery.data?.report;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Current Health
        </CardTitle>
        <CardDescription>
          Aggregated platform health from workflow, queue, runtime, schema, and
          tool registry checks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reportQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running doctor checks...
          </div>
        )}

        {reportQuery.isError && (
          <p className="text-sm text-destructive">
            {getApiErrorMessage(
              reportQuery.error,
              "Failed to load doctor report.",
            )}
          </p>
        )}

        {report && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={getStatusBadgeVariant(report.overall_status)}>
                {report.overall_status.toUpperCase()}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {report.summary.fail} fail, {report.summary.warn} warn,{" "}
                {report.summary.ok} ok
              </span>
              <span className="text-xs text-muted-foreground">
                Generated {formatDateTime(report.generated_at)}
              </span>
            </div>

            <div className="grid gap-3">
              {report.checks.map((check) => {
                const actionId = check.repair_action_id;

                return (
                  <Card key={check.check_id}>
                    <CardHeader className="space-y-2 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getStatusBadgeVariant(check.status)}>
                          {check.status.toUpperCase()}
                        </Badge>
                        <CardTitle className="text-base">
                          {check.check_id}
                        </CardTitle>
                      </div>
                      <CardDescription>
                        {check.evidence.summary}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                        {JSON.stringify(check.evidence.details, null, 2)}
                      </pre>

                      {actionId && (
                        <div className="space-y-2 rounded-md border p-3">
                          <Label htmlFor={`repair-args-${check.check_id}`}>
                            Repair Arguments JSON
                          </Label>
                          <Textarea
                            id={`repair-args-${check.check_id}`}
                            value={argumentsByAction[actionId] ?? "{}"}
                            onChange={(event) =>
                              setActionArguments(actionId, event.target.value)
                            }
                            className="font-mono text-xs"
                            rows={4}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() =>
                                onRunDryRepair(actionId, check.check_id)
                              }
                              disabled={repairPending}
                            >
                              Dry Run Repair
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() =>
                                onRunLiveRepair(actionId, check.check_id)
                              }
                              disabled={repairPending}
                            >
                              Run Repair
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
