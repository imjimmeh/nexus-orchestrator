import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PluginRegistryEntry } from '../database/entities/plugin-registry-entry.entity';
import { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import { PluginAuditService } from '../plugin-audit.service';
import { PluginPolicyService } from '../plugin-policy.service';
import type {
  PluginPolicyContext,
  PluginPolicyDecision,
} from '../plugin-policy.types';
import {
  PLUGIN_RUNTIME_ADAPTERS,
  type PluginRuntimeAdapter,
  type PluginRuntimeBaseRequest,
  type PluginRuntimeError,
  type PluginRuntimeEventDeliveryRequest,
  type PluginRuntimeHealthCheckResult,
  type PluginRuntimeInvokeRequest,
  type PluginRuntimeOperationResult,
  type PluginRuntimeShutdownRequest,
  type PluginRuntimeStartRequest,
} from './plugin-runtime.types';
import { PluginRuntimeHealthService } from './plugin-runtime-health.service';
import type { PluginRuntimeSupervisorService } from './plugin-runtime-supervisor.service';
import { PLUGIN_RUNTIME_SUPERVISOR } from './plugin-runtime-supervisor.token';
import {
  adapterBoundEventPayload,
  adapterBoundInvokePayload,
  buildPolicyContext,
  enforceRequestSize,
  normalizeAdapterError,
  normalizeAdapterResult,
  RUNTIME_CRASH_ERROR_CODES,
  runtimeError,
  runtimeIdentity,
} from './plugin-runtime-manager.helpers';
import type { RuntimeIdentity } from './plugin-runtime-manager.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;

@Injectable()
export class PluginRuntimeManagerService {
  constructor(
    private readonly registryEntries: PluginRegistryEntryRepository,
    private readonly pluginPolicy: PluginPolicyService,
    private readonly pluginAudit: PluginAuditService,
    @Optional()
    @Inject(PluginRuntimeHealthService)
    private readonly runtimeHealth: PluginRuntimeHealthService | undefined,
    private readonly moduleRef: ModuleRef,
    @Inject(PLUGIN_RUNTIME_ADAPTERS)
    private readonly adapters: readonly PluginRuntimeAdapter[] = [],
  ) {}

  async startPlugin(
    request: PluginRuntimeStartRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const resolved = await this.resolveRuntime(request);
    if (!resolved.ok) return resolved;

    const policyDecision = this.pluginPolicy.decideRuntimeStart({
      context: resolved.context,
    });
    if (!policyDecision.allowed) {
      return this.denyRuntimeCall(request, resolved.entry, policyDecision, {
        action: 'runtime.start.denied',
      });
    }

    return this.executeRuntimeOperation(
      'start',
      request,
      resolved.entry,
      () => resolved.adapter.start(request),
      request.timeoutMs,
      runtimeIdentity(request, resolved.entry.isolation_mode),
      async () => {
        await resolved.adapter.shutdown({
          pluginId: request.pluginId,
          version: request.version,
          actorId: request.actorId,
          reason: 'startup-timeout-cleanup',
        });
      },
    );
  }

  async invokePlugin(
    request: PluginRuntimeInvokeRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const requestSizeResult = enforceRequestSize(
      adapterBoundInvokePayload(request),
      request.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
    );
    if (!requestSizeResult.ok) return requestSizeResult;

    const resolved = await this.resolveRuntime(request);
    if (!resolved.ok) return resolved;

    const policyDecision = this.pluginPolicy.decideRuntimeInvocation({
      context: resolved.context,
      contributionId: request.contributionId,
      operation: request.operation,
    });
    if (!policyDecision.allowed) {
      return this.denyRuntimeCall(request, resolved.entry, policyDecision, {
        action: 'runtime.invoke.denied',
      });
    }

    return this.executeRuntimeOperation(
      'invoke',
      request,
      resolved.entry,
      () => resolved.adapter.invoke(request),
      request.timeoutMs,
      runtimeIdentity(request, resolved.entry.isolation_mode),
      undefined,
      request.contributionId,
    );
  }

  async deliverEvent(
    request: PluginRuntimeEventDeliveryRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const requestSizeResult = enforceRequestSize(
      adapterBoundEventPayload(request),
      request.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
    );
    if (!requestSizeResult.ok) return requestSizeResult;

    const resolved = await this.resolveRuntime(request);
    if (!resolved.ok) return resolved;

    const policyDecision = this.pluginPolicy.decideEventDelivery({
      context: resolved.context,
      topic: request.topic,
      contributionId: request.contributionId,
      requiredPermissions: request.requiredPermissions,
    });
    if (!policyDecision.allowed) {
      return this.denyRuntimeCall(request, resolved.entry, policyDecision, {
        action: 'runtime.event.denied',
      });
    }

    return this.executeRuntimeOperation(
      'event',
      request,
      resolved.entry,
      () => resolved.adapter.deliverEvent(request),
      request.timeoutMs,
      runtimeIdentity(request, resolved.entry.isolation_mode),
      undefined,
      request.contributionId,
    );
  }

  async checkHealth(
    request: PluginRuntimeBaseRequest,
  ): Promise<PluginRuntimeHealthCheckResult> {
    const resolved = await this.resolveRuntime(request);
    if (!resolved.ok) return resolved;

    const policyDecision = this.pluginPolicy.decideEventDelivery({
      context: resolved.context,
      topic: 'runtime.health',
    });
    if (!policyDecision.allowed) {
      return this.denyRuntimeCall(request, resolved.entry, policyDecision, {
        action: 'runtime.health.denied',
      });
    }

    return this.executeRuntimeOperation(
      'health',
      request,
      resolved.entry,
      () => resolved.adapter.healthCheck(request),
      request.timeoutMs,
      runtimeIdentity(request, resolved.entry.isolation_mode),
    );
  }

  async shutdownPlugin(
    request: PluginRuntimeShutdownRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const resolved = await this.resolveRuntime(request);
    if (!resolved.ok) return resolved;

    const policyDecision = this.pluginPolicy.decideEventDelivery({
      context: resolved.context,
      topic: 'runtime.shutdown',
    });
    if (!policyDecision.allowed) {
      return this.denyRuntimeCall(request, resolved.entry, policyDecision, {
        action: 'runtime.shutdown.denied',
      });
    }

    return this.executeRuntimeOperation(
      'shutdown',
      request,
      resolved.entry,
      () => resolved.adapter.shutdown(request),
      request.timeoutMs,
      runtimeIdentity(request, resolved.entry.isolation_mode),
    );
  }

  private async resolveRuntime(request: PluginRuntimeBaseRequest): Promise<
    | {
        readonly ok: true;
        readonly entry: PluginRegistryEntry;
        readonly context: PluginPolicyContext;
        readonly adapter: PluginRuntimeAdapter;
      }
    | { readonly ok: false; readonly error: PluginRuntimeError }
  > {
    const entry = await this.registryEntries.findByPluginIdAndVersion(
      request.pluginId,
      request.version,
    );
    if (!entry) {
      return runtimeError(
        'plugin_not_found',
        `Plugin ${request.pluginId}@${request.version} is not registered.`,
        false,
      );
    }

    const adapter = this.adapters.find(
      (candidate) => candidate.mode === entry.isolation_mode,
    );
    if (!adapter) {
      return runtimeError(
        'adapter_not_found',
        `No plugin runtime adapter is registered for isolation mode ${entry.isolation_mode}.`,
        false,
      );
    }

    return {
      ok: true,
      entry,
      context: buildPolicyContext(entry),
      adapter,
    };
  }

  private async denyRuntimeCall(
    request: PluginRuntimeBaseRequest,
    entry: PluginRegistryEntry,
    decision: Exclude<PluginPolicyDecision, { readonly allowed: true }>,
    denial: {
      readonly action: string;
    },
  ): Promise<{ readonly ok: false; readonly error: PluginRuntimeError }> {
    await this.pluginAudit.recordLifecycleEvent({
      action: denial.action,
      actorId: request.actorId,
      pluginId: entry.plugin_id,
      version: entry.version,
      result: 'denied',
      metadata: {
        reasonCode: decision.reasonCode,
        message: decision.message,
      },
    });
    await this.pluginAudit.recordRuntimeEvent({
      action: 'runtime.policy.denied',
      actorId: request.actorId,
      pluginId: entry.plugin_id,
      version: entry.version,
      mode: entry.isolation_mode,
      operation: denial.action.split('.')[1] ?? 'runtime',
      result: 'denied',
      metadata: {
        reasonCode: decision.reasonCode,
        message: decision.message,
      },
    });

    return runtimeError('policy_denied', decision.message, false, {
      reasonCode: decision.reasonCode,
    });
  }

  private async executeRuntimeOperation<
    T extends PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
  >(
    operation: string,
    request: PluginRuntimeBaseRequest,
    entry: PluginRegistryEntry,
    adapterCall: () => Promise<T>,
    timeoutMs: number | undefined,
    runtimeIdentity: RuntimeIdentity,
    onLateSuccess?: () => Promise<void>,
    contributionId?: string,
  ): Promise<T> {
    if (operation === 'start') {
      this.runtimeHealth?.recordStartup(runtimeIdentity);
    } else {
      this.runtimeHealth?.recordRequestStarted(runtimeIdentity);
    }

    const finishPendingRequest = () => {
      if (operation !== 'start') {
        this.runtimeHealth?.recordRequestFinished(runtimeIdentity);
      }
    };

    const result = await this.withTimeout(
      adapterCall,
      timeoutMs,
      runtimeIdentity,
      onLateSuccess,
      finishPendingRequest,
    );

    this.recordRuntimeHealth(operation, runtimeIdentity, result);
    await this.recordRuntimeAuditSafely(
      operation,
      request,
      entry,
      result,
      contributionId,
    );

    return result;
  }

  private recordRuntimeHealth(
    operation: string,
    runtimeIdentity: RuntimeIdentity,
    result: PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
  ): void {
    if (result.ok) {
      if (operation === 'health' && 'healthy' in result) {
        this.runtimeHealth?.recordHealthCheck({
          ...runtimeIdentity,
          healthy: result.healthy,
          details: result.details,
        });
      }
      if (operation === 'shutdown') {
        this.runtimeHealth?.recordShutdown(runtimeIdentity);
      }
      return;
    }

    this.runtimeHealth?.recordError({
      ...runtimeIdentity,
      code: result.error.code,
      message: 'Plugin runtime call failed.',
    });
  }

  private async recordRuntimeAudit(
    operation: string,
    request: PluginRuntimeBaseRequest,
    entry: PluginRegistryEntry,
    result: PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
    contributionId?: string,
  ): Promise<void> {
    const action = this.runtimeAuditAction(operation, result);
    await this.pluginAudit.recordRuntimeEvent({
      action,
      actorId: request.actorId,
      pluginId: entry.plugin_id,
      version: entry.version,
      mode: entry.isolation_mode,
      operation,
      ...(contributionId ? { contributionId } : {}),
      result: result.ok ? 'success' : 'failure',
      metadata: result.ok
        ? undefined
        : {
            errorCode: result.error.code,
            ...(result.error.code === 'runtime_timeout'
              ? { timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS }
              : {}),
          },
    });
  }

  private async recordRuntimeAuditSafely(
    operation: string,
    request: PluginRuntimeBaseRequest,
    entry: PluginRegistryEntry,
    result: PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
    contributionId?: string,
  ): Promise<void> {
    try {
      await this.recordRuntimeAudit(
        operation,
        request,
        entry,
        result,
        contributionId,
      );
    } catch {
      return;
    }
  }

  private runtimeAuditAction(
    operation: string,
    result: PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
  ): string {
    if (result.ok) return `runtime.${operation}.success`;
    if (result.error.code === 'runtime_timeout')
      return `runtime.${operation}.timeout`;
    if (RUNTIME_CRASH_ERROR_CODES.has(result.error.code))
      return 'runtime.crash';
    return `runtime.${operation}.failure`;
  }

  private withTimeout<
    T extends PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
  >(
    operation: () => Promise<T>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    runtimeIdentity?: RuntimeIdentity,
    onLateSuccess?: () => Promise<void>,
    onOperationSettled?: () => void,
  ): Promise<T> {
    return new Promise((resolve) => {
      let settled = false;
      let operationSettled = false;
      const markOperationSettled = () => {
        if (operationSettled) return;
        operationSettled = true;
        onOperationSettled?.();
      };
      const settle = (result: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => {
        markOperationSettled();
        settle(
          runtimeError(
            'runtime_timeout',
            `Plugin runtime call timed out after ${timeoutMs}ms.`,
            true,
          ) as T,
        );
      }, timeoutMs);

      operation()
        .then((result) => {
          const normalized = normalizeAdapterResult(result);
          this.recordRuntimeOutcomeSafely(result, runtimeIdentity);
          markOperationSettled();
          if (settled) {
            if (result.ok && onLateSuccess) {
              void onLateSuccess().catch(() => undefined);
            }
            return;
          }
          settle(normalized);
        })
        .catch((error: unknown) => {
          const normalized = normalizeAdapterError(error) as T;
          this.recordRuntimeCrashSafely(runtimeIdentity);
          markOperationSettled();
          settle(normalized);
        });
    });
  }

  private recordRuntimeOutcomeSafely(
    result: PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
    runtimeIdentity?: RuntimeIdentity,
  ): void {
    if (!runtimeIdentity) return;

    const runtimeSupervisor = this.getRuntimeSupervisor();
    if (!runtimeSupervisor) return;

    if (result.ok) {
      if ('healthy' in result && result.healthy) {
        runtimeSupervisor.recordRuntimeHealthy(runtimeIdentity);
      }
      return;
    }

    if (RUNTIME_CRASH_ERROR_CODES.has(result.error.code)) {
      this.recordRuntimeCrashSafely(runtimeIdentity);
    }
  }

  private recordRuntimeCrashSafely(runtimeIdentity?: RuntimeIdentity): void {
    if (!runtimeIdentity) return;

    const runtimeSupervisor = this.getRuntimeSupervisor();
    if (!runtimeSupervisor) return;

    void runtimeSupervisor
      .recordRuntimeCrash(runtimeIdentity)
      .then((result) => {
        this.runtimeHealth?.recordCrashLoop({
          ...runtimeIdentity,
          crashCount: result.crashCount,
          quarantined: result.quarantined,
        });
        if (result.quarantined) {
          void this.pluginAudit
            .recordRuntimeEvent({
              action: 'runtime.quarantine.triggered',
              actorId: 'plugin-runtime-supervisor',
              pluginId: runtimeIdentity.pluginId,
              version: runtimeIdentity.version,
              mode: runtimeIdentity.mode,
              operation: 'quarantine',
              result: 'success',
              metadata: {
                crashCount: result.crashCount,
                quarantined: result.quarantined,
              },
            })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }

  private getRuntimeSupervisor(): PluginRuntimeSupervisorService | undefined {
    try {
      return this.moduleRef.get<PluginRuntimeSupervisorService>(
        PLUGIN_RUNTIME_SUPERVISOR,
        { strict: false },
      );
    } catch {
      return undefined;
    }
  }
}
