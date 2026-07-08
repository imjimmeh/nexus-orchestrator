import { isRecord } from "./type-guards";

const ERROR_TEXT_FIELDS = ["message", "error", "stderr"] as const;

export function extractErrorText(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  for (const field of ERROR_TEXT_FIELDS) {
    const value = result[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}
