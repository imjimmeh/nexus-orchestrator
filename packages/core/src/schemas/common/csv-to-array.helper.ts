/**
 * Normalizes a comma-separated-value query filter into a trimmed, non-empty
 * string array, for use as a zod `preprocess` step ahead of an
 * `z.array(...)` schema.
 *
 * Accepts either a CSV query string (`?kind=a,b`) or an already-parsed array
 * (`?kind=a&kind=b`, which some query-string parsers hand us as `string[]`)
 * so both wire shapes normalize to the same result.
 */
function normalizeCsvItems(items: string[]): string[] | undefined {
  const cleaned = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function csvToArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return normalizeCsvItems(
      value.filter((item): item is string => typeof item === "string"),
    );
  }
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return normalizeCsvItems(value.split(","));
}
