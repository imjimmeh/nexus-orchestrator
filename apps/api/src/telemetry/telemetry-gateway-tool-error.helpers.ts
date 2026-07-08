import type { GatewayEventPayload } from './types';

function nonEmptyTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getStringFromDetails(
  details: Record<string, unknown>,
): string | undefined {
  const directMessage =
    nonEmptyTrimmed(details['error']) ?? nonEmptyTrimmed(details['message']);
  if (directMessage) {
    return directMessage;
  }

  const data = details['data'];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    const nestedMessage =
      nonEmptyTrimmed(nested['error']) ?? nonEmptyTrimmed(nested['message']);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return undefined;
}

function getToolResultContentText(
  payload: GatewayEventPayload,
): string | undefined {
  const result =
    payload.result && typeof payload.result === 'object'
      ? (payload.result as Record<string, unknown>)
      : undefined;
  if (!result) {
    return undefined;
  }

  const content = result['content'];
  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const text = nonEmptyTrimmed((item as Record<string, unknown>)['text']);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function getToolResultDetails(
  payload: GatewayEventPayload,
): Record<string, unknown> | undefined {
  const result =
    payload.result && typeof payload.result === 'object'
      ? (payload.result as Record<string, unknown>)
      : undefined;
  if (!result) {
    return undefined;
  }

  const details = result['details'];
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return undefined;
  }

  return details as Record<string, unknown>;
}

function getEnvelopeMessage(candidate: unknown): string | undefined {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }

  const envelope = candidate as Record<string, unknown>;
  const directMessage =
    nonEmptyTrimmed(envelope['message']) ?? nonEmptyTrimmed(envelope['error']);
  if (directMessage) {
    return directMessage;
  }

  const nestedError = envelope['error'];
  if (!nestedError || typeof nestedError !== 'object') {
    return undefined;
  }

  const nestedRecord = nestedError as Record<string, unknown>;
  return (
    nonEmptyTrimmed(nestedRecord['message']) ??
    nonEmptyTrimmed(nestedRecord['error'])
  );
}

export function getToolExecutionErrorMessage(
  payload: GatewayEventPayload,
): string {
  const direct = nonEmptyTrimmed(payload.errorMessage);
  if (direct) {
    return direct;
  }

  const payloadEnvelopeMessage = getEnvelopeMessage(payload.envelope);
  if (payloadEnvelopeMessage) {
    return payloadEnvelopeMessage;
  }

  const details = getToolResultDetails(payload);
  const detailsEnvelopeMessage = getEnvelopeMessage(details?.['envelope']);
  if (detailsEnvelopeMessage) {
    return detailsEnvelopeMessage;
  }

  const resultContentText = getToolResultContentText(payload);
  if (details) {
    return (
      getStringFromDetails(details) ??
      resultContentText ??
      '(no reason captured)'
    );
  }

  return resultContentText ?? '(no reason captured)';
}
