import type {
  PluginIsolationMode,
  PluginManifestContribution,
  PluginPermission,
  PluginRuntimeJsonValue,
} from '@nexus/plugin-sdk';
import type { PluginRegistryEntry } from '../database/entities/plugin-registry-entry.entity';
import type {
  PluginPolicyCompatibilityStatus,
  PluginPolicyContext,
  PluginPolicyRuntimeHealth,
  PluginPolicyScanStatus,
} from '../plugin-policy.types';
import type {
  PluginRuntimeBaseRequest,
  PluginRuntimeError,
  PluginRuntimeEventDeliveryRequest,
  PluginRuntimeHealthCheckResult,
  PluginRuntimeInvokeRequest,
  PluginRuntimeOperationResult,
} from './plugin-runtime.types';
import type { RuntimeIdentity } from './plugin-runtime-manager.types';

const SAFE_ADAPTER_ERROR_CODES = new Set(['adapter_failed']);
export const RUNTIME_CRASH_ERROR_CODES = new Set([
  'container_crashed',
  'container_health_failed',
  'container_start_failed',
  'ipc_send_failed',
  'runtime_error',
  'worker_error',
  'worker_exited',
  'worker_start_failed',
]);

export function runtimeIdentity(
  request: PluginRuntimeBaseRequest,
  mode: PluginIsolationMode,
): RuntimeIdentity {
  return {
    pluginId: request.pluginId,
    version: request.version,
    mode,
  };
}

export function runtimeError(
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, PluginRuntimeJsonValue>,
): { readonly ok: false; readonly error: PluginRuntimeError } {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(details ? { details } : {}),
    },
  };
}

export function buildPolicyContext(
  entry: PluginRegistryEntry,
): PluginPolicyContext {
  const contributions =
    entry.contributions as unknown as readonly PluginManifestContribution[];
  const requestedPermissions =
    entry.requested_permissions as unknown as readonly PluginPermission[];
  const grantedPermissions =
    entry.granted_permissions as unknown as readonly PluginPermission[];
  return {
    pluginId: entry.plugin_id,
    version: entry.version,
    trustLevel: entry.trust_level,
    isolationMode: entry.isolation_mode,
    lifecycleState: entry.lifecycle_state,
    enabled: entry.enabled,
    requestedPermissions,
    grantedPermissions,
    contributions,
    scanStatus: statusFromResult(entry.scan_result, 'not_scanned'),
    compatibilityStatus: statusFromResult(
      entry.compatibility_result,
      'unknown',
    ),
    runtimeHealth: runtimeHealthFromMetadata(entry.metadata),
    approvedUnsafeIsolation:
      entry.metadata?.approvedUnsafeIsolation === true ? true : undefined,
    supportedContributionOperations: supportedOperationsFromMetadata(
      entry.metadata,
      contributions,
    ),
  };
}

export function enforceRequestSize(
  payload: unknown,
  maxRequestBytes: number,
): PluginRuntimeOperationResult {
  let serializedPayload: string;
  try {
    serializedPayload = JSON.stringify(payload);
  } catch {
    return runtimeError(
      'request_not_serializable',
      'Plugin runtime request payload must be JSON serializable.',
      false,
    );
  }

  if (serializedPayload === undefined) {
    return runtimeError(
      'request_not_serializable',
      'Plugin runtime request payload must be JSON serializable.',
      false,
    );
  }

  if (Buffer.byteLength(serializedPayload, 'utf8') > maxRequestBytes) {
    return runtimeError(
      'request_too_large',
      `Plugin runtime request payload exceeds ${maxRequestBytes} bytes.`,
      false,
    );
  }

  return { ok: true };
}

export function normalizeAdapterError(
  error: unknown,
): PluginRuntimeOperationResult {
  void error;
  return runtimeError('runtime_error', 'Plugin runtime call failed.', true);
}

export function normalizeAdapterResult<
  T extends PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
>(result: T): T {
  if (result.ok) return result;
  return runtimeError(
    safeAdapterErrorCode(result.error.code),
    'Plugin runtime call failed.',
    result.error.retryable,
  ) as T;
}

export function adapterBoundInvokePayload(
  request: PluginRuntimeInvokeRequest,
): Record<string, unknown> {
  return {
    pluginId: request.pluginId,
    version: request.version,
    actorId: request.actorId,
    contributionId: request.contributionId,
    operation: request.operation,
    input: request.input,
    ...(request.timeoutMs === undefined
      ? {}
      : { timeoutMs: request.timeoutMs }),
    ...(request.maxRequestBytes === undefined
      ? {}
      : { maxRequestBytes: request.maxRequestBytes }),
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  };
}

export function adapterBoundEventPayload(
  request: PluginRuntimeEventDeliveryRequest,
): Record<string, unknown> {
  return {
    pluginId: request.pluginId,
    version: request.version,
    actorId: request.actorId,
    topic: request.topic,
    eventName: request.eventName,
    payload: request.payload,
    ...(request.timeoutMs === undefined
      ? {}
      : { timeoutMs: request.timeoutMs }),
    ...(request.maxRequestBytes === undefined
      ? {}
      : { maxRequestBytes: request.maxRequestBytes }),
  };
}

function statusFromResult<
  T extends PluginPolicyScanStatus | PluginPolicyCompatibilityStatus,
>(result: Record<string, unknown> | null, fallback: T): T {
  if (!result || typeof result.status !== 'string') return fallback;
  return result.status as T;
}

function runtimeHealthFromMetadata(
  metadata: Record<string, unknown> | null,
): PluginPolicyRuntimeHealth {
  if (!metadata || typeof metadata.runtimeHealth !== 'string') return 'healthy';
  return metadata.runtimeHealth as PluginPolicyRuntimeHealth;
}

function supportedOperationsFromMetadata(
  metadata: Record<string, unknown> | null,
  contributions: readonly PluginManifestContribution[],
): Readonly<Record<string, readonly string[]>> | undefined {
  const configuredOperations = metadata?.supportedContributionOperations;
  if (!isRecord(configuredOperations)) {
    return supportedOperationsFromContributions(contributions);
  }

  const supportedOperations: Record<string, readonly string[]> = {};
  for (const [contributionId, operations] of Object.entries(
    configuredOperations,
  )) {
    if (!Array.isArray(operations)) continue;
    const validOperations = operations.filter(
      (operation): operation is string =>
        typeof operation === 'string' && operation.length > 0,
    );
    if (validOperations.length > 0) {
      supportedOperations[contributionId] = validOperations;
    }
  }

  return Object.keys(supportedOperations).length > 0
    ? supportedOperations
    : supportedOperationsFromContributions(contributions);
}

function supportedOperationsFromContributions(
  contributions: readonly PluginManifestContribution[],
): Readonly<Record<string, readonly string[]>> | undefined {
  const supportedOperations: Record<string, readonly string[]> = {};

  for (const contribution of contributions) {
    if (
      !isRecord(contribution) ||
      !isInvocationContributionType(contribution.type) ||
      typeof contribution.id !== 'string' ||
      !isRecord(contribution.config) ||
      typeof contribution.config.operation !== 'string' ||
      contribution.config.operation.length === 0
    ) {
      continue;
    }

    supportedOperations[contribution.id] = [contribution.config.operation];
  }

  return Object.keys(supportedOperations).length > 0
    ? supportedOperations
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInvocationContributionType(
  type: unknown,
): type is 'tool' | 'workflow.step' {
  return type === 'tool' || type === 'workflow.step';
}

function safeAdapterErrorCode(code: string): string {
  return SAFE_ADAPTER_ERROR_CODES.has(code) ? code : 'runtime_error';
}
