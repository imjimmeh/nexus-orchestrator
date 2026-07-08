import type { CodeChangeProposalPayload } from '@nexus/core';

/**
 * Input to {@link buildImprovementTaskRequestedEnvelope} (see
 * `code-change.applier.helpers.ts`) — everything needed to map a validated
 * `code_change` proposal payload onto a neutral
 * `improvement.task.requested.v1` envelope, without depending on the
 * `ImprovementProposal` entity shape directly.
 */
export interface BuildImprovementTaskRequestedEnvelopeInput {
  proposalId: string;
  occurrenceCount: number;
  payload: CodeChangeProposalPayload;
  eventId: string;
  occurredAt: string;
}
