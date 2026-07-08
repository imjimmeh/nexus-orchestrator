import { Injectable } from '@nestjs/common';
import {
  workflowHookContributionSchema,
  type WorkflowHookContribution,
  type WorkflowHookEventName,
} from '@nexus/plugin-sdk';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type {
  PluginContributionCleanupRequest,
  PluginContributionInventoryEntry,
  PluginContributionProjectionInventoryEntry,
} from './plugin-contribution.types';
import type {
  BasePluginWorkflowHookProjectionResult,
  FailedPluginWorkflowHookResult,
  PluginWorkflowHookDeliveryRequest,
  PluginWorkflowHookDeliveryResult,
  PluginWorkflowHookProjectionResult,
  PluginWorkflowHookSubscription,
} from './plugin-workflow-hook-projection.types';

const DEFAULT_ACTOR_ID = 'plugin-workflow-hook-bridge';

@Injectable()
export class PluginWorkflowHookProjectionService {
  private readonly subscriptions = new Map<
    string,
    PluginWorkflowHookSubscription
  >();

  constructor(
    private readonly contributionRegistry: PluginContributionRegistryService,
    private readonly runtimeManager: PluginRuntimeManagerService,
  ) {}

  async projectEnabledWorkflowHooks(): Promise<
    PluginWorkflowHookProjectionResult[]
  > {
    const entries =
      await this.contributionRegistry.listActiveContributionProjectionEntries();
    this.reconcileActiveInventory(entries);

    return entries.flatMap((entry) => this.projectContribution(entry));
  }

  listHookSubscriptions(): PluginWorkflowHookSubscription[] {
    return Array.from(this.subscriptions.values(), (subscription) =>
      this.cloneSubscription(subscription),
    );
  }

  async deliverWorkflowHook(
    request: PluginWorkflowHookDeliveryRequest,
  ): Promise<PluginWorkflowHookDeliveryResult[]> {
    const matchingSubscriptions = this.listHookSubscriptions().filter(
      (subscription) => subscription.eventName === request.eventName,
    );
    const results: PluginWorkflowHookDeliveryResult[] = [];

    for (const subscription of matchingSubscriptions) {
      if (!this.matchesFilters(subscription, request)) {
        results.push({
          ...subscription,
          status: 'skipped',
          reason: 'filter_mismatch',
        });
        continue;
      }

      results.push(await this.deliverSubscription(subscription, request));
    }

    return results;
  }

  async cleanupPluginWorkflowHooks(
    request: PluginContributionCleanupRequest,
  ): Promise<PluginWorkflowHookProjectionResult[]> {
    const directCleanupResults = this.cleanupMatchingSubscriptions(request);
    if (directCleanupResults.length > 0) return directCleanupResults;

    const candidates =
      await this.contributionRegistry.calculateCleanupProjectionCandidates(
        request,
      );

    return candidates.flatMap((candidate) => this.cleanupCandidate(candidate));
  }

  private projectContribution(
    entry: PluginContributionProjectionInventoryEntry,
  ): PluginWorkflowHookProjectionResult[] {
    const base = this.toBaseResult(entry, entry.globalCapabilityName);
    this.deleteSubscriptionsForIdentity(entry);

    if (entry.lastValidationResult.status === 'invalid') {
      return [
        {
          ...base,
          status: 'failed',
          reason: 'invalid_contribution',
          errorMessage: entry.lastValidationResult.errorMessage,
        },
      ];
    }

    if (!this.isValidInventoryEntry(entry)) {
      return [
        this.invalidProjectionResult(
          base,
          'Invalid contribution projection entry',
        ),
      ];
    }

    if (entry.type !== 'workflow.hook') {
      return [{ ...base, status: 'skipped', reason: 'not_workflow_hook' }];
    }

    const parsed = workflowHookContributionSchema.safeParse(entry.contribution);
    if (!parsed.success) {
      return [this.invalidProjectionResult(base, parsed.error.message)];
    }

    const contribution = parsed.data;
    return contribution.config.events.map((eventName) => {
      const subscription = this.toSubscription(entry, contribution, eventName);
      this.subscriptions.set(
        this.toSubscriptionKey(subscription),
        subscription,
      );
      return {
        ...this.toBaseResult(entry, eventName),
        status: 'projected',
      };
    });
  }

  private async deliverSubscription(
    subscription: PluginWorkflowHookSubscription,
    request: PluginWorkflowHookDeliveryRequest,
  ): Promise<PluginWorkflowHookDeliveryResult> {
    try {
      const result = await this.runtimeManager.deliverEvent({
        pluginId: subscription.pluginId,
        version: subscription.version,
        actorId: request.actorId ?? DEFAULT_ACTOR_ID,
        contributionId: subscription.contributionId,
        topic: subscription.topic,
        eventName: subscription.eventName,
        payload: {
          eventName: request.eventName,
          operation: subscription.operation,
          payload: request.payload,
          context: request.context ?? {},
        },
      });

      if (result.ok) {
        return { ...subscription, status: 'delivered' };
      }

      return this.deliveryFailure(subscription, result.error);
    } catch {
      return this.deliveryFailure(subscription, {
        retryable: true,
      });
    }
  }

  private cleanupCandidate(
    candidate: PluginContributionProjectionInventoryEntry,
  ): PluginWorkflowHookProjectionResult[] {
    if (candidate.type !== 'workflow.hook') {
      return [
        {
          ...this.toBaseResult(candidate, candidate.globalCapabilityName),
          status: 'skipped',
          reason: 'not_workflow_hook',
        },
      ];
    }

    const matchingSubscriptions = this.listHookSubscriptions().filter(
      (subscription) =>
        subscription.pluginId === candidate.pluginId &&
        subscription.version === candidate.version &&
        subscription.contributionId === candidate.contributionId,
    );

    if (matchingSubscriptions.length === 0) {
      return [
        {
          ...this.toBaseResult(candidate, candidate.globalCapabilityName),
          status: 'skipped',
          reason: 'not_found',
        },
      ];
    }

    return matchingSubscriptions.map((subscription) => {
      this.subscriptions.delete(this.toSubscriptionKey(subscription));
      return {
        ...this.toBaseResult(candidate, subscription.eventName),
        status: 'cleaned',
      };
    });
  }

  private cleanupMatchingSubscriptions(
    request: PluginContributionCleanupRequest,
  ): PluginWorkflowHookProjectionResult[] {
    const matchingSubscriptions = this.listHookSubscriptions().filter(
      (subscription) =>
        subscription.pluginId === request.pluginId &&
        (request.version === undefined ||
          subscription.version === request.version),
    );

    return matchingSubscriptions.map((subscription) => {
      this.subscriptions.delete(this.toSubscriptionKey(subscription));
      return {
        ...this.toBaseResult(subscription, subscription.eventName),
        status: 'cleaned',
      };
    });
  }

  private reconcileActiveInventory(
    entries: PluginContributionProjectionInventoryEntry[],
  ): void {
    const activeVersionKeys = new Set(
      entries.map((entry) => this.toVersionKey(entry)),
    );
    const activeContributionKeys = new Set(
      entries.map((entry) => this.toContributionKey(entry)),
    );

    for (const subscription of this.listHookSubscriptions()) {
      const versionKey = this.toVersionKey(subscription);
      const contributionKey = this.toContributionKey(subscription);
      if (
        !activeVersionKeys.has(versionKey) ||
        !activeContributionKeys.has(contributionKey)
      ) {
        this.subscriptions.delete(this.toSubscriptionKey(subscription));
      }
    }
  }

  private matchesFilters(
    subscription: PluginWorkflowHookSubscription,
    request: PluginWorkflowHookDeliveryRequest,
  ): boolean {
    if (!subscription.filters) return true;

    const context = request.context ?? {};
    return Object.entries(subscription.filters).every(([key, expected]) => {
      if (!this.isScalarFilterValue(expected)) return false;

      // Context carries authoritative workflow metadata. Payload is used only
      // when context does not provide the filtered key.
      if (Object.prototype.hasOwnProperty.call(context, key)) {
        return context[key] === expected;
      }

      return request.payload[key] === expected;
    });
  }

  private isScalarFilterValue(value: unknown): boolean {
    return (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  }

  private deliveryFailure(
    subscription: PluginWorkflowHookSubscription,
    error: { readonly retryable: boolean },
  ): PluginWorkflowHookDeliveryResult {
    return {
      ...subscription,
      status: subscription.blocking ? 'blocking_failed' : 'failed',
      error: {
        code: 'plugin_workflow_hook_delivery_failed',
        message: 'Plugin workflow hook delivery failed.',
        retryable: error.retryable,
      },
    };
  }

  private toSubscription(
    entry: PluginContributionInventoryEntry,
    contribution: WorkflowHookContribution,
    eventName: WorkflowHookEventName,
  ): PluginWorkflowHookSubscription {
    return {
      pluginId: entry.pluginId,
      version: entry.version,
      contributionId: entry.contributionId,
      eventName,
      topic: eventName,
      operation: contribution.config.operation,
      blocking: contribution.config.blocking,
      filters: contribution.config.filters,
      status: 'active',
    };
  }

  private invalidProjectionResult(
    base: BasePluginWorkflowHookProjectionResult,
    errorMessage: string,
  ): FailedPluginWorkflowHookResult {
    return {
      ...base,
      status: 'failed',
      reason: 'invalid_contribution',
      errorMessage,
    };
  }

  private toBaseResult(
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version' | 'contributionId'
    >,
    eventName: string,
  ): BasePluginWorkflowHookProjectionResult {
    return {
      status: 'projected',
      pluginId: entry.pluginId,
      version: entry.version,
      contributionId: entry.contributionId,
      eventName,
      topic: eventName,
    };
  }

  private toSubscriptionKey(
    subscription: PluginWorkflowHookSubscription,
  ): string {
    return `${subscription.pluginId}\u0000${subscription.version}\u0000${subscription.contributionId}\u0000${subscription.eventName}`;
  }

  private cloneSubscription(
    subscription: PluginWorkflowHookSubscription,
  ): PluginWorkflowHookSubscription {
    return {
      ...subscription,
      filters: subscription.filters ? { ...subscription.filters } : undefined,
    };
  }

  private toVersionKey(
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version'
    >,
  ): string {
    return `${entry.pluginId}\u0000${entry.version}`;
  }

  private toContributionKey(
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version' | 'contributionId'
    >,
  ): string {
    return `${entry.pluginId}\u0000${entry.version}\u0000${entry.contributionId}`;
  }

  private deleteSubscriptionsForIdentity(
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version' | 'contributionId'
    >,
  ): void {
    const contributionKey = this.toContributionKey(entry);
    for (const subscription of this.listHookSubscriptions()) {
      if (this.toContributionKey(subscription) === contributionKey) {
        this.subscriptions.delete(this.toSubscriptionKey(subscription));
      }
    }
  }

  private isValidInventoryEntry(
    entry: PluginContributionProjectionInventoryEntry,
  ): entry is PluginContributionInventoryEntry {
    return entry.lastValidationResult.status === 'valid';
  }
}
