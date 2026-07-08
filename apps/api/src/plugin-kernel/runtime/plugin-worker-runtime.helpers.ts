import type {
  PluginErrorMessage,
  PluginRuntimeJsonValue,
  PluginRuntimeProtocolMessage,
} from '@nexus/plugin-sdk';
import type { PluginRuntimeError } from './plugin-runtime.types';
import type {
  CorrelatedProtocolMessage,
  RuntimeProcessIdentity,
} from './plugin-worker-runtime.types';

export function protocolError(message: PluginErrorMessage): {
  readonly ok: false;
  readonly error: PluginRuntimeError;
} {
  return safeError(message.code, 'Plugin worker process failed.', true);
}

export function safeInvalidIpcMessage(): {
  readonly ok: false;
  readonly error: PluginRuntimeError;
} {
  return safeError(
    'invalid_ipc_message',
    'Plugin worker returned an invalid IPC message.',
    true,
  );
}

export function safeError(
  code: string,
  message: string,
  retryable: boolean,
): { readonly ok: false; readonly error: PluginRuntimeError } {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
    },
  };
}

export function isCorrelated(
  message: PluginRuntimeProtocolMessage,
): message is CorrelatedProtocolMessage {
  return 'correlationId' in message;
}

export function getCorrelationId(
  message: PluginRuntimeProtocolMessage,
): string {
  if (!isCorrelated(message)) {
    throw new Error('Worker IPC message must be correlated.');
  }

  return message.correlationId;
}

export function runtimeKey(value: RuntimeProcessIdentity): string {
  return `${value.pluginId}\0${value.version}`;
}

export function toRuntimeJsonValue(value: unknown): PluginRuntimeJsonValue {
  return JSON.parse(JSON.stringify(value)) as PluginRuntimeJsonValue;
}

export function addPendingCorrelation(
  counts: Map<string, number>,
  expectedCounts: Map<string, Map<string, number>>,
  correlationId: string,
  expectedTypes: readonly string[],
): void {
  counts.set(correlationId, pendingCorrelationCount(counts, correlationId) + 1);
  const typeCounts =
    expectedCounts.get(correlationId) ?? new Map<string, number>();
  for (const expectedType of expectedTypes) {
    typeCounts.set(expectedType, (typeCounts.get(expectedType) ?? 0) + 1);
  }
  expectedCounts.set(correlationId, typeCounts);
}

export function removePendingCorrelation(
  counts: Map<string, number>,
  expectedCounts: Map<string, Map<string, number>>,
  correlationId: string,
  expectedTypes: readonly string[],
): void {
  removePendingExpectedTypes(expectedCounts, correlationId, expectedTypes);
  const nextCount = pendingCorrelationCount(counts, correlationId) - 1;
  if (nextCount > 0) {
    counts.set(correlationId, nextCount);
    return;
  }
  counts.delete(correlationId);
}

export function hasPendingExpectedType(
  expectedCounts: Map<string, Map<string, number>>,
  correlationId: string,
  expectedType: string,
): boolean {
  return (expectedCounts.get(correlationId)?.get(expectedType) ?? 0) > 0;
}

export function hasPendingCorrelation(
  counts: Map<string, number>,
  correlationId: string,
): boolean {
  return pendingCorrelationCount(counts, correlationId) > 0;
}

function removePendingExpectedTypes(
  expectedCounts: Map<string, Map<string, number>>,
  correlationId: string,
  expectedTypes: readonly string[],
): void {
  const typeCounts = expectedCounts.get(correlationId);
  if (!typeCounts) return;
  for (const expectedType of expectedTypes) {
    const nextCount = (typeCounts.get(expectedType) ?? 0) - 1;
    if (nextCount > 0) typeCounts.set(expectedType, nextCount);
    else typeCounts.delete(expectedType);
  }
  if (typeCounts.size === 0) expectedCounts.delete(correlationId);
}

function pendingCorrelationCount(
  counts: Map<string, number>,
  correlationId: string,
): number {
  return counts.get(correlationId) ?? 0;
}
