type StoredDeadLetterEnvelope = {
  payload?: {
    proposalId?: unknown;
  };
};

/**
 * Extracts the `proposalId` embedded in a dead-lettered lifecycle stream
 * row's `payload.envelope` (a JSON-stringified event envelope). Fails soft
 * to `null` on any malformed or missing shape so a single unparsable row can
 * never abort a dead-letter replay or list operation.
 */
export function extractProposalId(
  payload: Record<string, unknown> | null,
): string | null {
  const envelopeJson = payload?.envelope;
  if (typeof envelopeJson !== "string") {
    return null;
  }

  try {
    const envelope = JSON.parse(envelopeJson) as StoredDeadLetterEnvelope;
    const proposalId = envelope.payload?.proposalId;
    return typeof proposalId === "string" ? proposalId : null;
  } catch {
    return null;
  }
}
