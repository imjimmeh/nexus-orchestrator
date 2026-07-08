/**
 * Pure helper that narrows an `unknown` orchestration-metadata
 * value into the `Record<string, unknown>` shape both retrospective
 * services persist against. Extracted so the duplicated
 * "non-null, non-array object" guard in
 * {@link KanbanRetrospectiveEvidenceService.getRecord} and
 * {@link KanbanRetrospectiveFailureThresholdService.getRecordMetadata}
 * stops drifting.
 *
 * Work item: ef4d6799-8468-4c4b-b8d6-20e8f0fca384 (M4).
 */

/**
 * Returns `value` unchanged when it is a plain record
 * (non-null, non-array object), otherwise returns `{}`. Designed
 * for the `metadata` field on a `KanbanOrchestrationEntity` /
 * `KanbanEventDeliveryProjectionEntity.payload_snapshot` where the
 * column is typed as JSON (`unknown`) but the surrounding code
 * expects key/value reads.
 */
export function narrowMetadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}