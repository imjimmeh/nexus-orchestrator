import { DoctorRepairActionId, DoctorRepairHistoryItem } from "@/lib/api/doctor.types";

export const DEFAULT_ACTION_ARGUMENTS: Record<DoctorRepairActionId, string> = {
  clear_stale_polling_markers: '{\n  "max_age_minutes": 60\n}',
  requeue_recoverable_workflow_runs:
    '{\n  "max_runs": 25,\n  "stale_pending_minutes": 10\n}',
  prune_orphaned_runtime_artifacts: "{}",
  refresh_mcp_plugin_catalogs: "{}",
};

export function getStatusBadgeVariant(status: "ok" | "warn" | "fail") {
  if (status === "fail") {
    return "destructive" as const;
  }

  if (status === "warn") {
    return "secondary" as const;
  }

  return "default" as const;
}

export function getHistoryStatusBadgeVariant(status: string) {
  if (status === "failed") {
    return "destructive" as const;
  }

  if (status === "partial" || status === "running") {
    return "secondary" as const;
  }

  return "default" as const;
}

export function readHistoryMessage(item: DoctorRepairHistoryItem): string {
  const message = item.result_json?.message;
  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  return item.error_message ?? "-";
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function parseActionArguments(
  raw: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string } {
  if (!raw.trim()) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        reason: "Arguments JSON must be an object.",
      };
    }

    return {
      ok: true,
      value: parsed as Record<string, unknown>,
    };
  } catch {
    return {
      ok: false,
      reason: "Arguments JSON is invalid.",
    };
  }
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readAutonomyHistoryContext(
  item: DoctorRepairHistoryItem,
): string | null {
  const input = item.input_json;
  if (!input) {
    return null;
  }

  const argumentsInput = readRecord(input.arguments);
  const workflowRunId =
    readString(input.workflow_run_id) ??
    readString(argumentsInput?.workflow_run_id);
  const failedJobId =
    readString(input.failed_job_id) ??
    readString(argumentsInput?.failed_job_id);
  const policyActionId =
    readString(input.policy_action_id) ??
    readString(argumentsInput?.policy_action_id);
  const repairAttempt =
    readNumber(input.repair_attempt) ??
    readNumber(argumentsInput?.repair_attempt);

  if (
    !workflowRunId ||
    !failedJobId ||
    !policyActionId ||
    repairAttempt === null
  ) {
    return null;
  }

  return `workflow run ${workflowRunId} · job ${failedJobId} · policy ${policyActionId} · attempt ${repairAttempt}`;
}
