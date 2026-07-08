import { Injectable } from '@nestjs/common';
import { PluginEventDeliveryRepository } from '../database/repositories/plugin-event-delivery.repository';
import type { PluginEventDelivery } from '../database/entities/plugin-event-delivery.entity';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';

@Injectable()
export class PluginEventDeliveryWorkerService {
  constructor(
    private readonly deliveryRepository: PluginEventDeliveryRepository,
    private readonly runtimeManager: PluginRuntimeManagerService,
  ) {}

  async processDueDeliveries(limit = 20): Promise<number> {
    const dueDeliveries = await this.deliveryRepository.claimDueDeliveries(
      limit,
      new Date(),
    );

    for (const delivery of dueDeliveries) {
      await this.processOneDelivery(delivery);
    }

    return dueDeliveries.length;
  }

  private async processOneDelivery(
    delivery: PluginEventDelivery,
  ): Promise<void> {
    const runtimeResult = await this.runtimeManager.deliverEvent({
      pluginId: delivery.plugin_id,
      version: delivery.plugin_version,
      actorId: 'plugin-event-delivery-worker',
      contributionId: delivery.contribution_id,
      topic: delivery.topic,
      eventName: delivery.event_name,
      payload: delivery.payload,
    });

    if (runtimeResult.ok) {
      await this.deliveryRepository.markDelivered(delivery.id, new Date());
      return;
    }

    const nextAttemptCount = delivery.attempt_count + 1;
    const exhausted = nextAttemptCount >= delivery.max_attempts;

    if (runtimeResult.error.retryable && !exhausted) {
      const nextAttemptAt = new Date(
        Date.now() +
          this.computeBackoffDelayMs(
            delivery.retry_initial_delay_ms,
            delivery.retry_backoff_multiplier,
            delivery.attempt_count,
          ),
      );
      await this.deliveryRepository.markFailed({
        id: delivery.id,
        nextAttemptAt,
        errorCode: runtimeResult.error.code,
        errorMessage: this.toSafeMessage(runtimeResult.error.message),
        errorMetadata: {
          retryable: true,
          nextAttemptAt: nextAttemptAt.toISOString(),
        },
        incrementAttemptCount: true,
      });
      return;
    }

    if (delivery.dead_letter_enabled) {
      await this.deliveryRepository.markDeadLettered({
        id: delivery.id,
        errorCode: runtimeResult.error.code,
        errorMessage: this.toSafeMessage(runtimeResult.error.message),
        errorMetadata: {
          retryable: runtimeResult.error.retryable,
          exhausted,
        },
      });
      return;
    }

    await this.deliveryRepository.markFailed({
      id: delivery.id,
      errorCode: runtimeResult.error.code,
      errorMessage: this.toSafeMessage(runtimeResult.error.message),
      errorMetadata: {
        retryable: runtimeResult.error.retryable,
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

  private toSafeMessage(message: string): string {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return 'Plugin event delivery failed.';
    }

    return trimmed.length > 256 ? `${trimmed.slice(0, 253)}...` : trimmed;
  }
}
