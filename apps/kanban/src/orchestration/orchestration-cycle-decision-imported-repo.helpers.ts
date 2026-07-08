/**
 * Helpers that detect whether the orchestration metadata carries
 * "imported repository" context — the cycle decision service uses this
 * to gate the premature `complete` decision guard.
 *
 * Extracted from `orchestration-cycle-decision.service.ts` to keep that
 * service under the repository's `max-lines` lint rule.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
 */

export function hasImportedRepoContext(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const record = getRecordMetadata(metadata);

  return (
    hasImportRemoteSource(record) ||
    hasImportRemoteSource(record.sourceContext) ||
    hasImportedRepoStartupHint(record.startupHints)
  );
}

function hasImportRemoteSource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  return (
    record.sourceType === "import_remote" ||
    record.source_type === "import_remote"
  );
}

function hasImportedRepoStartupHint(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  if (hasImportRemoteSource(record)) return true;

  const explicitRouteHints = [
    record.preferredRouteId,
    record.routeId,
    record.selectedRoute,
    record.selectedRuleId,
  ];

  return explicitRouteHints.some(
    (hint) =>
      typeof hint === "string" &&
      (hint.includes("import_remote") ||
        hint.includes("imported_repo") ||
        hint.includes("imported-repo")),
  );
}

function getRecordMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}