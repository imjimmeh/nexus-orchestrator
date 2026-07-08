/**
 * Extracts a human-readable message from an unknown error value.
 * Safe to call with any value — never throws.
 */
export function getErrorMessage(error: unknown): string {
  if (error == null) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}
