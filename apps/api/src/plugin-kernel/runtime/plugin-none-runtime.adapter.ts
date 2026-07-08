import { Injectable } from '@nestjs/common';
import type { PluginRuntimeJsonValue } from '@nexus/plugin-sdk';
import type {
  PluginRuntimeAdapter,
  PluginRuntimeBaseRequest,
  PluginRuntimeEventDeliveryRequest,
  PluginRuntimeHealthCheckResult,
  PluginRuntimeInvokeRequest,
  PluginRuntimeOperationResult,
  PluginRuntimeShutdownRequest,
  PluginRuntimeStartRequest,
  TrustedPluginRuntimeHandlers,
} from './plugin-runtime.types';

const HANDLER_FAILED_MESSAGE = 'Trusted plugin runtime handler failed.';

@Injectable()
export class PluginNoneRuntimeAdapter implements PluginRuntimeAdapter {
  readonly mode = 'none' as const;

  private readonly trustedRuntimes = new Map<
    string,
    Map<string, TrustedPluginRuntimeHandlers>
  >();

  registerTrustedPluginRuntime(
    pluginId: string,
    version: string,
    handlers: TrustedPluginRuntimeHandlers,
  ): void {
    const pluginRuntimes =
      this.trustedRuntimes.get(pluginId) ??
      new Map<string, TrustedPluginRuntimeHandlers>();

    pluginRuntimes.set(version, { ...handlers });
    this.trustedRuntimes.set(pluginId, pluginRuntimes);
  }

  async start(
    request: PluginRuntimeStartRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const handlers = this.findHandlers(request);
    if (!handlers.ok) return handlers;

    if (!handlers.value.handshake) return this.missingHandler('handshake');
    if (!handlers.value.declareContributions) {
      return this.missingHandler('declareContributions');
    }

    try {
      const handshake = await handlers.value.handshake(request);
      const contributions = await handlers.value.declareContributions(request);

      return {
        ok: true,
        output: this.toRuntimeJsonValue({ handshake, contributions }),
      };
    } catch {
      return this.handlerFailed();
    }
  }

  async invoke(
    request: PluginRuntimeInvokeRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const handlers = this.findHandlers(request);
    if (!handlers.ok) return handlers;
    if (!handlers.value.invoke) return this.missingHandler('invoke');

    return this.callOperationHandler(() => handlers.value.invoke?.(request));
  }

  async deliverEvent(
    request: PluginRuntimeEventDeliveryRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const handlers = this.findHandlers(request);
    if (!handlers.ok) return handlers;
    if (!handlers.value.deliverEvent)
      return this.missingHandler('deliverEvent');

    return this.callOperationHandler(() =>
      handlers.value.deliverEvent?.(request),
    );
  }

  async healthCheck(
    request: PluginRuntimeBaseRequest,
  ): Promise<PluginRuntimeHealthCheckResult> {
    const handlers = this.findHandlers(request);
    if (!handlers.ok) return handlers;
    if (!handlers.value.healthCheck) return this.missingHandler('healthCheck');

    try {
      const result = await handlers.value.healthCheck(request);
      if ('ok' in result) return this.normalizeHealthCheckResult(result);

      return {
        ok: true,
        healthy: result.healthy,
        details: result.details,
      };
    } catch {
      return this.handlerFailed();
    }
  }

  async shutdown(
    request: PluginRuntimeShutdownRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const handlers = this.findHandlers(request);
    if (!handlers.ok) return handlers;
    if (!handlers.value.shutdown) return this.missingHandler('shutdown');

    return this.callOperationHandler(() => handlers.value.shutdown?.(request));
  }

  private async callOperationHandler(
    handler: () =>
      | Promise<
          PluginRuntimeOperationResult | PluginRuntimeJsonValue | undefined
        >
      | PluginRuntimeOperationResult
      | PluginRuntimeJsonValue
      | undefined,
  ): Promise<PluginRuntimeOperationResult> {
    try {
      const result = await handler();
      if (this.isRuntimeOperationResult(result)) {
        return this.normalizeOperationResult(result);
      }
      if (result === undefined) return { ok: true };

      return { ok: true, output: this.toRuntimeJsonValue(result) };
    } catch {
      return this.handlerFailed();
    }
  }

  private findHandlers(request: PluginRuntimeBaseRequest):
    | { readonly ok: true; readonly value: TrustedPluginRuntimeHandlers }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly message: string;
          readonly retryable: boolean;
        };
      } {
    const handlers = this.trustedRuntimes
      .get(request.pluginId)
      ?.get(request.version);
    if (!handlers) {
      return {
        ok: false,
        error: {
          code: 'trusted_runtime_not_registered',
          message:
            'Trusted plugin runtime is not registered for this plugin version.',
          retryable: false,
        },
      };
    }

    return { ok: true, value: handlers };
  }

  private missingHandler(handlerName: string): {
    readonly ok: false;
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly retryable: false;
    };
  } {
    return {
      ok: false,
      error: {
        code: 'missing_handler',
        message: `Trusted plugin runtime does not export the required ${handlerName} handler.`,
        retryable: false,
      },
    };
  }

  private handlerFailed(): {
    readonly ok: false;
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly retryable: true;
    };
  } {
    return {
      ok: false,
      error: {
        code: 'handler_failed',
        message: HANDLER_FAILED_MESSAGE,
        retryable: true,
      },
    };
  }

  private normalizeOperationResult(
    result: PluginRuntimeOperationResult,
  ): PluginRuntimeOperationResult {
    if (result.ok) return result;

    return this.handlerFailedWithRetryable(result.error.retryable);
  }

  private normalizeHealthCheckResult(
    result: PluginRuntimeHealthCheckResult,
  ): PluginRuntimeHealthCheckResult {
    if (result.ok) return result;

    return this.handlerFailedWithRetryable(result.error.retryable);
  }

  private handlerFailedWithRetryable(retryable: boolean): {
    readonly ok: false;
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    };
  } {
    return {
      ok: false,
      error: {
        code: 'handler_failed',
        message: HANDLER_FAILED_MESSAGE,
        retryable,
      },
    };
  }

  private isRuntimeOperationResult(
    value: PluginRuntimeOperationResult | PluginRuntimeJsonValue | undefined,
  ): value is PluginRuntimeOperationResult {
    return typeof value === 'object' && value !== null && 'ok' in value;
  }

  private toRuntimeJsonValue(value: unknown): PluginRuntimeJsonValue {
    return JSON.parse(JSON.stringify(value)) as PluginRuntimeJsonValue;
  }
}
