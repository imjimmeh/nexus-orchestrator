import type {
  PluginIsolationMode,
  PluginManifestContribution,
  PluginRuntimeJsonValue,
} from '@nexus/plugin-sdk';

export const PLUGIN_RUNTIME_ADAPTERS = Symbol('PLUGIN_RUNTIME_ADAPTERS');

export interface PluginRuntimeAdapter {
  readonly mode: PluginIsolationMode;
  start(
    request: PluginRuntimeStartRequest,
  ): Promise<PluginRuntimeOperationResult>;
  invoke(
    request: PluginRuntimeInvokeRequest,
  ): Promise<PluginRuntimeOperationResult>;
  deliverEvent(
    request: PluginRuntimeEventDeliveryRequest,
  ): Promise<PluginRuntimeOperationResult>;
  healthCheck(
    request: PluginRuntimeBaseRequest,
  ): Promise<PluginRuntimeHealthCheckResult>;
  shutdown(
    request: PluginRuntimeShutdownRequest,
  ): Promise<PluginRuntimeOperationResult>;
}

export interface PluginRuntimeBaseRequest {
  readonly pluginId: string;
  readonly version: string;
  readonly actorId: string;
  readonly timeoutMs?: number;
}

export type PluginRuntimeStartRequest = PluginRuntimeBaseRequest;

export interface PluginRuntimeInvokeRequest extends PluginRuntimeBaseRequest {
  readonly contributionId: string;
  readonly operation: string;
  readonly input: unknown;
  readonly maxRequestBytes?: number;
  readonly metadata?: Record<string, PluginRuntimeJsonValue>;
}

export interface PluginRuntimeEventDeliveryRequest extends PluginRuntimeBaseRequest {
  readonly contributionId?: string;
  readonly topic: string;
  readonly eventName: string;
  readonly payload: unknown;
  readonly requiredPermissions?: readonly string[];
  readonly maxRequestBytes?: number;
}

export interface PluginRuntimeShutdownRequest extends PluginRuntimeBaseRequest {
  readonly reason: string;
  readonly deadlineMs?: number;
}

export interface PluginRuntimeError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Record<string, PluginRuntimeJsonValue>;
}

export type PluginRuntimeOperationResult =
  | { readonly ok: true; readonly output?: PluginRuntimeJsonValue }
  | { readonly ok: false; readonly error: PluginRuntimeError };

export type PluginRuntimeHealthCheckResult =
  | {
      readonly ok: true;
      readonly healthy: boolean;
      readonly details?: Record<string, PluginRuntimeJsonValue>;
    }
  | { readonly ok: false; readonly error: PluginRuntimeError };

export interface TrustedPluginRuntimeHandlers {
  readonly handshake?: (
    request: PluginRuntimeStartRequest,
  ) =>
    | Promise<PluginRuntimeJsonValue | undefined>
    | PluginRuntimeJsonValue
    | undefined;
  readonly declareContributions?: (
    request: PluginRuntimeStartRequest,
  ) =>
    | Promise<readonly PluginManifestContribution[]>
    | readonly PluginManifestContribution[];
  readonly invoke?: (
    request: PluginRuntimeInvokeRequest,
  ) =>
    | Promise<PluginRuntimeOperationResult | PluginRuntimeJsonValue | undefined>
    | PluginRuntimeOperationResult
    | PluginRuntimeJsonValue
    | undefined;
  readonly deliverEvent?: (
    request: PluginRuntimeEventDeliveryRequest,
  ) =>
    | Promise<PluginRuntimeOperationResult | PluginRuntimeJsonValue | undefined>
    | PluginRuntimeOperationResult
    | PluginRuntimeJsonValue
    | undefined;
  readonly healthCheck?: (request: PluginRuntimeBaseRequest) =>
    | Promise<
        | PluginRuntimeHealthCheckResult
        | {
            readonly healthy: boolean;
            readonly details?: Record<string, PluginRuntimeJsonValue>;
          }
      >
    | PluginRuntimeHealthCheckResult
    | {
        readonly healthy: boolean;
        readonly details?: Record<string, PluginRuntimeJsonValue>;
      };
  readonly shutdown?: (
    request: PluginRuntimeShutdownRequest,
  ) =>
    | Promise<PluginRuntimeOperationResult | PluginRuntimeJsonValue | undefined>
    | PluginRuntimeOperationResult
    | PluginRuntimeJsonValue
    | undefined;
}
