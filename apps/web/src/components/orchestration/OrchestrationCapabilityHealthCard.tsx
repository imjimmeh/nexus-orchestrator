import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectOrchestrationDiagnostics, ReplayProjectRetrospectiveRequest, RuntimeCapabilitiesSnapshot } from "@/lib/api/orchestration.types";

interface OrchestrationCapabilityHealthCardProps {
  diagnostics?: ProjectOrchestrationDiagnostics;
  capabilities?: RuntimeCapabilitiesSnapshot;
  diagnosticsLoading: boolean;
  capabilitiesLoading: boolean;
  capabilitiesError?: string | null;
  diagnosticsError?: string | null;
  replayRetrospectivePending?: boolean;
  onReplayRetrospective?: (
    mode: ReplayProjectRetrospectiveRequest["mode"],
  ) => Promise<void>;
}

interface CapabilitySectionParams {
  capabilities?: RuntimeCapabilitiesSnapshot;
  capabilitiesLoading: boolean;
  capabilitiesError?: string | null;
}

interface DiagnosticsSectionParams {
  diagnostics?: ProjectOrchestrationDiagnostics;
  diagnosticsLoading: boolean;
  diagnosticsError?: string | null;
  replayMode: "append" | "replace";
  onReplayModeChange: (mode: "append" | "replace") => void;
  replayRetrospectivePending: boolean;
  onReplayRetrospective?: (
    mode: ReplayProjectRetrospectiveRequest["mode"],
  ) => Promise<void>;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

function actionVariant(
  action: RuntimeCapabilitiesSnapshot["required_next_action"],
) {
  if (action === "approval_required") {
    return "default" as const;
  }

  if (action === "review_policy_or_mode") {
    return "destructive" as const;
  }

  return "secondary" as const;
}

function retrospectiveVariant(status: string) {
  if (status === "failed") {
    return "destructive" as const;
  }

  if (status === "succeeded" || status === "skipped_duplicate") {
    return "secondary" as const;
  }

  if (status === "running") {
    return "default" as const;
  }

  return "outline" as const;
}

function renderBlockedReasons(
  reasons: ProjectOrchestrationDiagnostics["reasons"],
) {
  if (reasons.length === 0) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
        No orchestration blockers detected.
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        Blocked Reasons
      </p>
      <ul className="space-y-1">
        {reasons.map((reason) => (
          <li key={reason.code}>
            <span className="font-medium">{reason.code}</span>: {reason.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderDispatchPolling(
  dispatchPolling: ProjectOrchestrationDiagnostics["dispatch_polling"],
) {
  if (!dispatchPolling) {
    return null;
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        Dispatch Polling
      </p>
      <p>Status: {dispatchPolling.enabled ? "enabled" : "disabled"}</p>
      <p>Last tick: {formatTimestamp(dispatchPolling.last_tick?.createdAt)}</p>
      <p>
        Last project outcome:{" "}
        {dispatchPolling.last_project_outcome?.reason ?? "n/a"}
      </p>
    </div>
  );
}

function renderDispatchCapacity(
  dispatchCapacity: ProjectOrchestrationDiagnostics["dispatch_capacity"],
) {
  if (!dispatchCapacity) {
    return null;
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        Dispatch Capacity
      </p>
      <p>
        Active / max: {dispatchCapacity.activeCount} /{" "}
        {dispatchCapacity.maxActive}
      </p>
      <p>Available slots: {dispatchCapacity.availableSlots}</p>
      <p>
        Agent capacity:{" "}
        {dispatchCapacity.agentCapacityEnabled ? "enabled" : "disabled"}
      </p>
      {dispatchCapacity.agentCapacityEnabled ? (
        <p>
          Idle agents: {dispatchCapacity.idleAgentCount} of{" "}
          {dispatchCapacity.configuredAgentCount}
        </p>
      ) : null}
    </div>
  );
}

function renderRetrospective(params: DiagnosticsSectionParams) {
  const retrospective = params.diagnostics?.retrospective;
  if (!retrospective) {
    return null;
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Retrospective
        </p>
        <Badge variant={retrospectiveVariant(retrospective.status)}>
          {retrospective.status}
        </Badge>
      </div>
      <p>Lesson count: {retrospective.lesson_count}</p>
      <p>Last trigger: {retrospective.last_trigger_type ?? "n/a"}</p>
      <p>
        Last trigger time: {formatTimestamp(retrospective.last_triggered_at)}
      </p>
      <p>Last skip reason: {retrospective.last_skip_reason ?? "n/a"}</p>
      <p>Last started: {formatTimestamp(retrospective.last_started_at)}</p>
      <p>Last completed: {formatTimestamp(retrospective.last_completed_at)}</p>
      {retrospective.last_delta_snapshot ? (
        <p className="text-xs text-muted-foreground">
          Snapshot: {retrospective.last_delta_snapshot.done_work_items}/
          {retrospective.last_delta_snapshot.total_work_items} done,{" "}
          {retrospective.last_delta_snapshot.failed_workflow_runs} failed runs
        </p>
      ) : null}
      {retrospective.last_error_message ? (
        <p className="text-destructive">
          Last error: {retrospective.last_error_message}
        </p>
      ) : null}
      {retrospective.remediation ? (
        <p className="text-xs text-muted-foreground">
          Remediation: {retrospective.remediation}
        </p>
      ) : null}

      {params.onReplayRetrospective ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            value={params.replayMode}
            onValueChange={(value: "append" | "replace") => {
              params.onReplayModeChange(value);
            }}
            disabled={params.replayRetrospectivePending}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Replay mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="append">append</SelectItem>
              <SelectItem value="replace">replace</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={params.replayRetrospectivePending}
            onClick={() => {
              void params.onReplayRetrospective?.(params.replayMode);
            }}
          >
            {params.replayRetrospectivePending
              ? "Replaying..."
              : "Replay retrospective"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function renderCapabilitiesSection(params: CapabilitySectionParams) {
  if (params.capabilitiesLoading) {
    return (
      <p className="text-muted-foreground">Loading capability snapshot...</p>
    );
  }

  if (params.capabilitiesError) {
    return <p className="text-destructive">{params.capabilitiesError}</p>;
  }

  if (!params.capabilities) {
    return (
      <p className="text-muted-foreground">
        Capability snapshot is unavailable until a workflow run is active.
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Callable Tools</p>
          <p className="text-lg font-semibold">
            {params.capabilities.callable_tools.length}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Approval Required</p>
          <p className="text-lg font-semibold">
            {params.capabilities.approval_required_tools.length}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Denied Tools</p>
          <p className="text-lg font-semibold">
            {params.capabilities.denied_tools.length}
          </p>
        </div>
      </div>

      {params.capabilities.denied_tools.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-medium text-amber-900">
            Denied Tool Reasons
          </p>
          <ul className="space-y-1">
            {params.capabilities.denied_tools.slice(0, 5).map((entry) => (
              <li key={`${entry.toolName}:${entry.reasonCode}`}>
                <span className="font-medium">{entry.toolName}</span>:{" "}
                {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function renderDiagnosticsSection(params: DiagnosticsSectionParams) {
  if (params.diagnosticsLoading) {
    return (
      <p className="text-muted-foreground">
        Loading orchestration diagnostics...
      </p>
    );
  }

  if (params.diagnosticsError) {
    return <p className="text-destructive">{params.diagnosticsError}</p>;
  }

  if (!params.diagnostics) {
    return null;
  }

  return (
    <div className="space-y-3">
      {renderBlockedReasons(params.diagnostics.reasons)}
      {renderDispatchPolling(params.diagnostics.dispatch_polling)}
      {renderDispatchCapacity(params.diagnostics.dispatch_capacity)}
      {renderRetrospective(params)}
    </div>
  );
}

export function OrchestrationCapabilityHealthCard({
  diagnostics,
  capabilities,
  diagnosticsLoading,
  capabilitiesLoading,
  capabilitiesError,
  diagnosticsError,
  replayRetrospectivePending = false,
  onReplayRetrospective,
}: Readonly<OrchestrationCapabilityHealthCardProps>) {
  const [replayMode, setReplayMode] = useState<"append" | "replace">("append");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Runtime Capability Health
          {capabilities ? (
            <Badge variant={actionVariant(capabilities.required_next_action)}>
              {capabilities.required_next_action}
            </Badge>
          ) : (
            <Badge variant="outline">unavailable</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {renderCapabilitiesSection({
          capabilities,
          capabilitiesLoading,
          capabilitiesError,
        })}
        {renderDiagnosticsSection({
          diagnostics,
          diagnosticsLoading,
          diagnosticsError,
          replayMode,
          onReplayModeChange: setReplayMode,
          replayRetrospectivePending,
          onReplayRetrospective,
        })}
      </CardContent>
    </Card>
  );
}
