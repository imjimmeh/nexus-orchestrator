export function buildJobCompletedPayload(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    outputKeys: Object.keys(output),
  };

  if (typeof output.ok === 'boolean') {
    payload.outputOk = output.ok;
  }

  const outputErrorMessage = extractOutputErrorMessage(output);
  if (outputErrorMessage) {
    payload.outputErrorMessage = outputErrorMessage;
  }

  return payload;
}

function extractOutputErrorMessage(
  output: Record<string, unknown>,
): string | undefined {
  const candidates = [
    output.error,
    output.errorMessage,
    output.message,
    output.reason,
    output.merge_message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}
