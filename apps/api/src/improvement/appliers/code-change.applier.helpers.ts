import type { BuildImprovementTaskRequestedEnvelopeInput } from './code-change.applier.types';

/**
 * Pure mapping from a validated `code_change` proposal payload to the
 * pre-validation shape of an `improvement.task.requested.v1` envelope. The
 * caller (`CodeChangeApplier`) re-validates the result against
 * `ImprovementTaskRequestedEventEnvelopeV1Schema` before publishing, so this
 * helper only needs to get the field mapping right.
 */
export function buildImprovementTaskRequestedEnvelope(
  input: BuildImprovementTaskRequestedEnvelopeInput,
): unknown {
  const { proposalId, occurrenceCount, payload, eventId, occurredAt } = input;

  return {
    event_id: eventId,
    event_type: 'improvement.task.requested.v1',
    event_version: 'v1',
    occurred_at: occurredAt,
    correlation_id: proposalId,
    source_service: 'core',
    payload: {
      proposalId,
      title: payload.title,
      description: payload.description,
      ...(payload.suspectedArea
        ? { suspectedArea: payload.suspectedArea }
        : {}),
      evidence: payload.evidence,
      severity: payload.severity,
      occurrenceCount,
    },
  };
}
