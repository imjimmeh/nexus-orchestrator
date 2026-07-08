import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { twMerge } from "tailwind-merge";
import type { WorkflowRunStatus } from "./api/common.types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function parseDateValue(
  date: string | Date | null | undefined,
): Date | null {
  if (!date) {
    return null;
  }

  const parsedDate = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

export function formatDate(
  date: string | Date | null | undefined,
  fallback = "",
): string {
  const parsedDate = parseDateValue(date);
  return parsedDate ? parsedDate.toLocaleString() : fallback;
}

export function formatDateTimeSafe(
  date: string | Date | null | undefined,
  fallback = "",
): string {
  return formatDate(date, fallback);
}

export function formatDateSafe(
  date: string | Date | null | undefined,
  pattern: string,
  fallback = "",
): string {
  const parsedDate = parseDateValue(date);
  return parsedDate ? format(parsedDate, pattern) : fallback;
}

export function formatDistanceToNowSafe(
  date: string | Date | null | undefined,
  fallback: string,
  options?: { addSuffix?: boolean },
): string {
  const parsedDate = parseDateValue(date);
  return parsedDate
    ? formatDistanceToNow(parsedDate, { addSuffix: options?.addSuffix ?? true })
    : fallback;
}

export function getDateSortValue(
  date: string | Date | null | undefined,
  fallback = 0,
): number {
  const parsedDate = parseDateValue(date);
  return parsedDate ? parsedDate.getTime() : fallback;
}

export function formatDuration(
  start: string | Date | null | undefined,
  end?: string | Date | null,
): string {
  const startDate = parseDateValue(start);
  if (!startDate) {
    return "0s";
  }

  const endDate = parseDateValue(end ?? new Date()) ?? new Date();

  const diffMs = endDate.getTime() - startDate.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m ${diffSecs % 60}s`;
  }
  if (diffMins > 0) {
    return `${diffMins}m ${diffSecs % 60}s`;
  }
  return `${diffSecs}s`;
}

export function getStatusColor(status: WorkflowRunStatus): string {
  switch (status) {
    case "PENDING":
      return "text-yellow-500";
    case "RUNNING":
      return "text-blue-500";
    case "COMPLETED":
      return "text-green-500";
    case "FAILED":
      return "text-red-500";
    case "CANCELLED":
      return "text-gray-500";
    default:
      return "text-gray-500";
  }
}
