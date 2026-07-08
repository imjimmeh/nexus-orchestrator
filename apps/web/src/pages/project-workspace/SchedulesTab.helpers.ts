import { ScheduledJob } from "@/lib/api/scheduled-jobs.types";

const SCHEDULED_JOB_TYPES = ["cron", "interval", "one_time"] as const;

export function formatScheduleDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function parseSchedulePayloadJson(
  text: string,
): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload JSON must be an object.");
  }

  return parsed as Record<string, unknown>;
}

export function scheduleStatusVariant(
  status: ScheduledJob["status"],
): "default" | "outline" {
  if (status === "active") {
    return "default";
  }

  return "outline";
}

export function scheduleRunStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "succeeded") {
    return "default";
  }

  if (status === "failed") {
    return "destructive";
  }

  if (status === "running" || status === "triggered") {
    return "secondary";
  }

  return "outline";
}

export function scheduleExpressionPlaceholder(
  scheduleType: ScheduledJob["schedule_type"],
): string {
  if (scheduleType === "one_time") {
    return "2026-12-31T20:00:00.000Z";
  }

  if (scheduleType === "interval") {
    return "60";
  }

  return "*/15 * * * *";
}

export function isScheduledJobType(
  value: string,
): value is ScheduledJob["schedule_type"] {
  return SCHEDULED_JOB_TYPES.includes(
    value as (typeof SCHEDULED_JOB_TYPES)[number],
  );
}

export function toSchedulePayloadText(
  payload: Record<string, unknown>,
): string {
  if (Object.keys(payload).length === 0) {
    return "";
  }

  return JSON.stringify(payload, null, 2);
}

export function normalizeScheduleTimezone(
  input: string,
  scheduleType: ScheduledJob["schedule_type"],
): string | undefined {
  const trimmed = input.trim();

  if (scheduleType !== "cron") {
    return undefined;
  }

  return trimmed.length > 0 ? trimmed : "UTC";
}
