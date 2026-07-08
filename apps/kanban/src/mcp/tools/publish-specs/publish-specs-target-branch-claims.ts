import type { SpecParseResult } from "./spec-parser";

const CONFLICT_STATUSES = new Set([
  "todo",
  "in-progress",
  "in-review",
  "ready-to-merge",
]);

type PublishSpecError = { source_path: string; message: string };
type WorkItemRecord = Record<string, unknown>;
type TargetBranchClaim = { sourcePath: string; sourceId: string };

export function validateTargetBranchClaims(
  specs: SpecParseResult[],
  existingItems: unknown[],
  itemsBySourceId: Map<string, WorkItemRecord>,
): { errors: PublishSpecError[]; erroredSourceIds: Set<string> } {
  const errors: PublishSpecError[] = [];
  const erroredSourceIds = new Set<string>();
  const specSourceIds = new Set(specs.map((spec) => spec.sourceId));
  const targetBranchClaims = new Map<string, TargetBranchClaim>();

  seedExistingTargetBranchClaims(
    existingItems,
    specSourceIds,
    targetBranchClaims,
  );
  seedPreservedInBatchTargetBranchClaims(
    specs,
    itemsBySourceId,
    targetBranchClaims,
  );

  for (const spec of specs) {
    validateSpecTargetBranch(
      spec,
      itemsBySourceId,
      targetBranchClaims,
      erroredSourceIds,
      errors,
    );
  }

  return { errors, erroredSourceIds };
}

function seedExistingTargetBranchClaims(
  existingItems: unknown[],
  specSourceIds: Set<string>,
  targetBranchClaims: Map<string, TargetBranchClaim>,
): void {
  for (const item of existingItems) {
    const itemRecord = item as WorkItemRecord;
    const metadata = asRecord(itemRecord.metadata);
    const sourceId = asString(metadata?.sourceId);
    if (sourceId && specSourceIds.has(sourceId)) continue;

    const claimIdentity = sourceId ?? asString(itemRecord.id);
    const existingStatus = asString(itemRecord.status);
    const targetBranch = getTargetBranch(itemRecord);
    if (!claimIdentity || !isConflictStatus(existingStatus) || !targetBranch)
      continue;

    const claimSourcePath = asString(metadata?.sourcePath) ?? claimIdentity;
    if (!targetBranchClaims.has(targetBranch)) {
      targetBranchClaims.set(targetBranch, {
        sourcePath: claimSourcePath,
        sourceId: claimIdentity,
      });
    }
  }
}

function seedPreservedInBatchTargetBranchClaims(
  specs: SpecParseResult[],
  itemsBySourceId: Map<string, WorkItemRecord>,
  targetBranchClaims: Map<string, TargetBranchClaim>,
): void {
  for (const spec of specs) {
    const existing = itemsBySourceId.get(spec.sourceId);
    const specTargetBranch = asString(
      spec.executionConfig?.targetBranch,
    )?.trim();
    if (!existing) continue;
    if (specTargetBranch && specTargetBranch.length > 0) continue;

    const existingStatus = asString(existing.status);
    const resultingStatus = spec.status ?? existingStatus ?? "todo";
    const targetBranch = getTargetBranch(existing);
    if (!isConflictStatus(resultingStatus) || !targetBranch) continue;

    if (!targetBranchClaims.has(targetBranch)) {
      targetBranchClaims.set(targetBranch, {
        sourcePath: spec.sourcePath,
        sourceId: spec.sourceId,
      });
    }
  }
}

function validateSpecTargetBranch(
  spec: SpecParseResult,
  itemsBySourceId: Map<string, WorkItemRecord>,
  targetBranchClaims: Map<string, TargetBranchClaim>,
  erroredSourceIds: Set<string>,
  errors: PublishSpecError[],
): void {
  if (erroredSourceIds.has(spec.sourceId)) return;

  const existing = itemsBySourceId.get(spec.sourceId);
  const specTargetBranch = asString(spec.executionConfig?.targetBranch)?.trim();
  const targetBranch =
    specTargetBranch && specTargetBranch.length > 0
      ? specTargetBranch
      : existing
        ? getTargetBranch(existing)
        : undefined;
  if (!targetBranch) return;

  const existingStatus = asString(existing?.status);
  const resultingStatus = spec.status ?? existingStatus ?? "todo";
  if (!isConflictStatus(resultingStatus)) return;

  const existingClaim = targetBranchClaims.get(targetBranch);
  if (existingClaim && existingClaim.sourceId !== spec.sourceId) {
    errors.push({
      source_path: spec.sourcePath,
      message: `Duplicate dispatchable target_branch ${targetBranch}; already claimed by ${existingClaim.sourceId} (${existingClaim.sourcePath})`,
    });
    erroredSourceIds.add(spec.sourceId);
    return;
  }

  targetBranchClaims.set(targetBranch, {
    sourcePath: spec.sourcePath,
    sourceId: spec.sourceId,
  });
}

function getTargetBranch(itemRecord: WorkItemRecord): string | undefined {
  const execConfig = asRecord(itemRecord.executionConfig);
  return asString(execConfig?.targetBranch)?.trim();
}

function isConflictStatus(status: string | undefined): boolean {
  return Boolean(status && CONFLICT_STATUSES.has(status));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
