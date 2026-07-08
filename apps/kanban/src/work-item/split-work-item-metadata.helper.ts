function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function getSplitParentId(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;

  const split = metadata.split;
  if (isRecord(split)) {
    const canonicalParentId = nonEmptyString(split.parentId);
    if (canonicalParentId) return canonicalParentId;
  }

  return nonEmptyString(metadata.parent_context_id);
}

export function withCanonicalSplitParentId(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const parentId = getSplitParentId(metadata);
  if (!parentId) return metadata;

  const split = isRecord(metadata.split) ? metadata.split : {};
  return {
    ...metadata,
    split: {
      ...split,
      parentId,
    },
  };
}
