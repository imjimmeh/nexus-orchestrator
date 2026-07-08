import { Injectable } from '@nestjs/common';
import type {
  PluginManifestContribution,
  PluginPermission,
} from '@nexus/plugin-sdk';
import { PluginEventDeliveryRepository } from '../database/repositories/plugin-event-delivery.repository';
import { PluginPolicyService } from '../plugin-policy.service';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import { PluginEventSubscriptionProjectionService } from './plugin-event-subscription-projection.service';
import type { PluginRuntimeError } from '../runtime/plugin-runtime.types';
import type { PluginEventEnvelope } from './plugin-event-envelope.types';
import type { PluginEventSubscription } from './plugin-event-subscription.types';
import type {
  PluginEventCandidateDeliveryResult,
  PluginEventDeliveryEngineResult,
} from './plugin-event-delivery-engine.types';

@Injectable()
export class PluginEventDeliveryEngineService {
  constructor(
    private readonly subscriptionProjection: PluginEventSubscriptionProjectionService,
    private readonly runtimeManager: PluginRuntimeManagerService,
    private readonly policyService: PluginPolicyService,
    private readonly registryEntries: PluginRegistryEntryRepository,
    private readonly deliveryRepository: PluginEventDeliveryRepository,
  ) {}

  async deliver(
    envelope: PluginEventEnvelope,
  ): Promise<PluginEventDeliveryEngineResult> {
    const subscriptions = this.subscriptionProjection.findMatchingSubscriptions(
      envelope.topic,
      envelope.payload,
    );

    const deliveries: PluginEventCandidateDeliveryResult[] = [];

    for (const subscription of subscriptions) {
      const deliveryResult = await this.deliverToSubscription(
        envelope,
        subscription,
      );
      deliveries.push(deliveryResult.delivery);

      if (deliveryResult.blockingFailure) {
        return {
          ok: false,
          deliveries,
          blockingFailure: deliveryResult.delivery,
        };
      }
    }

    return { ok: true, deliveries };
  }

  private async deliverToSubscription(
    envelope: PluginEventEnvelope,
    subscription: PluginEventSubscription,
  ): Promise<{
    readonly delivery: PluginEventCandidateDeliveryResult;
    readonly blockingFailure: boolean;
  }> {
    const createdDelivery = await this.deliveryRepository.createPending({
      pluginId: subscription.pluginId,
      pluginVersion: subscription.version,
      contributionId: subscription.contributionId,
      topic: envelope.topic,
      eventName: envelope.eventName,
      payload: envelope.payload,
      correlationId: envelope.correlationId,
      deliveryMode: subscription.deliveryMode,
      maxAttempts: subscription.retry.maxAttempts,
      retryInitialDelayMs: subscription.retry.initialDelayMs,
      retryBackoffMultiplier: subscription.retry.backoffMultiplier,
      deadLetterEnabled: subscription.deadLetter?.enabled ?? false,
      nextAttemptAt: new Date(),
    });

    const registryEntry = await this.registryEntries.findByPluginIdAndVersion(
      subscription.pluginId,
      subscription.version,
    );
    if (!registryEntry) {
      return this.markPolicyFailure(
        createdDelivery.id,
        envelope,
        subscription,
        {
          code: 'plugin_not_found',
          message: 'Plugin runtime target is unavailable.',
        },
      );
    }

    const contributions = this.toPluginContributions(
      registryEntry.contributions,
    );
    const decision = this.policyService.decideEventDelivery({
      context: {
        pluginId: registryEntry.plugin_id,
        version: registryEntry.version,
        trustLevel: registryEntry.trust_level,
        isolationMode: registryEntry.isolation_mode,
        lifecycleState: registryEntry.lifecycle_state,
        enabled: registryEntry.enabled,
        requestedPermissions: this.toPluginPermissions(
          registryEntry.requested_permissions,
        ),
        grantedPermissions: this.toPluginPermissions(
          registryEntry.granted_permissions,
        ),
        contributions,
        scanStatus:
          registryEntry.scan_result?.status === 'passed' ? 'passed' : 'failed',
        compatibilityStatus:
          registryEntry.compatibility_result?.status === 'passed'
            ? 'passed'
            : 'failed',
        runtimeHealth: 'healthy',
        supportedContributionOperations:
          this.toSupportedContributionOperations(contributions),
      },
      topic: envelope.topic,
      contributionId: subscription.contributionId,
      requiredPermissions: subscription.requiredPermissions,
    });

    if (!decision.allowed) {
      return this.markPolicyFailure(
        createdDelivery.id,
        envelope,
        subscription,
        {
          code: decision.reasonCode,
          message: decision.message,
        },
      );
    }

    const runtimeResult = await this.runtimeManager.deliverEvent({
      pluginId: subscription.pluginId,
      version: subscription.version,
      actorId: 'plugin-event-delivery-engine',
      contributionId: subscription.contributionId,
      requiredPermissions: subscription.requiredPermissions,
      topic: envelope.topic,
      eventName: envelope.eventName,
      payload: envelope.payload,
    });

    if (!runtimeResult.ok) {
      return this.markRuntimeFailure(
        createdDelivery,
        envelope,
        subscription,
        runtimeResult.error,
      );
    }

    await this.deliveryRepository.markDelivered(createdDelivery.id, new Date());
    return {
      delivery: this.toDeliveryResult(envelope, subscription, 'delivered'),
      blockingFailure: false,
    };
  }

  private async markPolicyFailure(
    deliveryId: string,
    envelope: PluginEventEnvelope,
    subscription: PluginEventSubscription,
    error: { readonly code: string; readonly message: string },
  ): Promise<{
    readonly delivery: PluginEventCandidateDeliveryResult;
    readonly blockingFailure: boolean;
  }> {
    await this.deliveryRepository.markFailed({
      id: deliveryId,
      errorCode: error.code,
      errorMessage: error.message,
      errorMetadata: { status: 'policy_denied' },
      incrementAttemptCount: false,
    });

    const delivery = this.toDeliveryResult(
      envelope,
      subscription,
      'policy_denied',
      error.code,
    );
    return {
      delivery,
      blockingFailure: subscription.deliveryMode === 'blocking',
    };
  }

  private async markRuntimeFailure(
    delivery: {
      id: string;
      attempt_count: number;
      max_attempts: number;
      retry_initial_delay_ms: number;
      retry_backoff_multiplier: number;
      dead_letter_enabled: boolean;
    },
    envelope: PluginEventEnvelope,
    subscription: PluginEventSubscription,
    error: PluginRuntimeError,
  ): Promise<{
    readonly delivery: PluginEventCandidateDeliveryResult;
    readonly blockingFailure: boolean;
  }> {
    await this.handleRuntimeFailure(delivery, error);
    const failed = this.toDeliveryResult(
      envelope,
      subscription,
      'delivery_failed',
      error.code,
    );
    return {
      delivery: failed,
      blockingFailure: subscription.deliveryMode === 'blocking',
    };
  }

  private toDeliveryResult(
    envelope: PluginEventEnvelope,
    subscription: PluginEventSubscription,
    status: PluginEventCandidateDeliveryResult['status'],
    errorCode?: string,
  ): PluginEventCandidateDeliveryResult {
    return {
      pluginId: subscription.pluginId,
      version: subscription.version,
      contributionId: subscription.contributionId,
      topic: envelope.topic,
      correlationId: envelope.correlationId,
      status,
      deliveryMode: subscription.deliveryMode,
      ...(errorCode ? { errorCode } : {}),
    };
  }

  private async handleRuntimeFailure(
    delivery: {
      id: string;
      attempt_count: number;
      max_attempts: number;
      retry_initial_delay_ms: number;
      retry_backoff_multiplier: number;
      dead_letter_enabled: boolean;
    },
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    const nextAttemptCount = delivery.attempt_count + 1;
    const exhausted = nextAttemptCount >= delivery.max_attempts;

    if (error.retryable && !exhausted) {
      const retryDelayMs = this.computeBackoffDelayMs(
        delivery.retry_initial_delay_ms,
        delivery.retry_backoff_multiplier,
        delivery.attempt_count,
      );
      await this.deliveryRepository.markFailed({
        id: delivery.id,
        nextAttemptAt: new Date(Date.now() + retryDelayMs),
        errorCode: error.code,
        errorMessage: 'Plugin event delivery failed.',
        errorMetadata: { retryable: true },
        incrementAttemptCount: true,
      });
      return;
    }

    if (delivery.dead_letter_enabled) {
      await this.deliveryRepository.markDeadLettered({
        id: delivery.id,
        errorCode: error.code,
        errorMessage: 'Plugin event delivery failed.',
        errorMetadata: {
          retryable: error.retryable,
          exhausted,
        },
      });
      return;
    }

    await this.deliveryRepository.markFailed({
      id: delivery.id,
      errorCode: error.code,
      errorMessage: 'Plugin event delivery failed.',
      errorMetadata: {
        retryable: error.retryable,
        exhausted,
      },
      incrementAttemptCount: true,
    });
  }

  private computeBackoffDelayMs(
    initialDelayMs: number,
    backoffMultiplier: number,
    attemptCount: number,
  ): number {
    const boundedInitialDelay = Math.min(Math.max(initialDelayMs, 100), 60_000);
    const boundedMultiplier = Math.min(Math.max(backoffMultiplier, 1), 10);
    const computedDelay =
      boundedInitialDelay *
      Math.pow(boundedMultiplier, Math.max(attemptCount, 0));
    return Math.min(Math.round(computedDelay), 300_000);
  }

  private toPluginPermissions(permissions: unknown): PluginPermission[] {
    return Array.isArray(permissions)
      ? (permissions as PluginPermission[])
      : [];
  }

  private toPluginContributions(
    contributions: unknown,
  ): PluginManifestContribution[] {
    return Array.isArray(contributions)
      ? (contributions as PluginManifestContribution[])
      : [];
  }

  private toSupportedContributionOperations(
    contributions: PluginManifestContribution[],
  ): Readonly<Record<string, readonly string[]>> {
    return contributions.reduce<Record<string, readonly string[]>>(
      (accumulator, contribution) => {
        const contributionId = contribution.id;
        const operation =
          typeof contribution.config === 'object' &&
          contribution.config !== null
            ? ((contribution.config as { operation?: string }).operation ??
              undefined)
            : undefined;
        if (!contributionId || !operation) {
          return accumulator;
        }

        return {
          ...accumulator,
          [contributionId]: [operation],
        };
      },
      {},
    );
  }
}
