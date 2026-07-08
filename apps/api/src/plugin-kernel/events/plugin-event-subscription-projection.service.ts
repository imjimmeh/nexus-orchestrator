import { Injectable } from '@nestjs/common';
import {
  eventSubscriptionContributionSchema,
  type EventSubscriptionContribution,
} from '@nexus/plugin-sdk';
import { PluginContributionRegistryService } from '../contributions/plugin-contribution-registry.service';
import type {
  PluginContributionCleanupRequest,
  PluginContributionProjectionInventoryEntry,
} from '../contributions/plugin-contribution.types';
import {
  isApprovedTopicPatternForPlugin,
  matchesTopicPattern,
} from './plugin-event-topic-catalog';
import type {
  PluginEventSubscription,
  PluginEventSubscriptionProjectionResult,
} from './plugin-event-subscription.types';

@Injectable()
export class PluginEventSubscriptionProjectionService {
  private readonly subscriptions = new Map<string, PluginEventSubscription>();

  constructor(
    private readonly contributionRegistry: PluginContributionRegistryService,
  ) {}

  async projectEnabledEventSubscriptions(): Promise<
    PluginEventSubscriptionProjectionResult[]
  > {
    const entries =
      await this.contributionRegistry.listActiveContributionProjectionEntries();
    const results: PluginEventSubscriptionProjectionResult[] = [];

    this.subscriptions.clear();

    for (const entry of entries) {
      results.push(this.projectContribution(entry));
    }

    return results;
  }

  listActiveSubscriptions(): PluginEventSubscription[] {
    return Array.from(this.subscriptions.values(), (subscription) => ({
      ...subscription,
      topics: [...subscription.topics],
      filters: subscription.filters ? { ...subscription.filters } : undefined,
      retry: { ...subscription.retry },
      deadLetter: subscription.deadLetter
        ? { ...subscription.deadLetter }
        : undefined,
      requiredPermissions: subscription.requiredPermissions
        ? [...subscription.requiredPermissions]
        : undefined,
    }));
  }

  findMatchingSubscriptions(
    topic: string,
    payload?: Record<string, unknown>,
  ): PluginEventSubscription[] {
    return this.listActiveSubscriptions().filter((subscription) => {
      const matchesTopic = subscription.topics.some((topicPattern) =>
        matchesTopicPattern(topicPattern, topic),
      );

      if (!matchesTopic) {
        return false;
      }

      return this.matchesFilters(subscription.filters, payload);
    });
  }

  async cleanupPluginEventSubscriptions(
    request: PluginContributionCleanupRequest,
  ): Promise<PluginEventSubscriptionProjectionResult[]> {
    const currentMatches = this.removeMatchingSubscriptions(request);
    if (currentMatches.length > 0) {
      return currentMatches;
    }

    const candidates =
      await this.contributionRegistry.calculateCleanupProjectionCandidates(
        request,
      );

    return candidates
      .filter((candidate) => candidate.type === 'event.subscription')
      .map((candidate) => ({
        status: 'skipped',
        pluginId: candidate.pluginId,
        version: candidate.version,
        contributionId: candidate.contributionId,
        topics: [],
        reason: 'not_found',
      }));
  }

  private projectContribution(
    entry: PluginContributionProjectionInventoryEntry,
  ): PluginEventSubscriptionProjectionResult {
    if (entry.type !== 'event.subscription') {
      return {
        status: 'skipped',
        pluginId: entry.pluginId,
        version: entry.version,
        contributionId: entry.contributionId,
        topics: [],
        reason: 'not_event_subscription',
      };
    }

    if (entry.lastValidationResult.status === 'invalid') {
      return {
        status: 'failed',
        pluginId: entry.pluginId,
        version: entry.version,
        contributionId: entry.contributionId,
        topics: [],
        reason: 'invalid_contribution',
        errorMessage: entry.lastValidationResult.errorMessage,
      };
    }

    const parsed = eventSubscriptionContributionSchema.safeParse(
      entry.contribution,
    );
    if (!parsed.success) {
      return {
        status: 'failed',
        pluginId: entry.pluginId,
        version: entry.version,
        contributionId: entry.contributionId,
        topics: [],
        reason: 'invalid_contribution',
        errorMessage: parsed.error.message,
      };
    }

    const contribution = parsed.data as EventSubscriptionContribution;
    const invalidTopic = contribution.config.topics.find(
      (topicPattern) =>
        !isApprovedTopicPatternForPlugin(topicPattern, entry.pluginId),
    );
    if (invalidTopic) {
      return {
        status: invalidTopic.startsWith('plugin.') ? 'failed' : 'failed',
        pluginId: entry.pluginId,
        version: entry.version,
        contributionId: entry.contributionId,
        topics: contribution.config.topics,
        reason: invalidTopic.startsWith('plugin.')
          ? 'namespace_impersonation'
          : 'invalid_topic_pattern',
      };
    }

    const subscription = this.toSubscription(
      entry.pluginId,
      entry.version,
      contribution,
    );
    this.subscriptions.set(this.subscriptionKey(subscription), subscription);

    return {
      status: 'projected',
      pluginId: entry.pluginId,
      version: entry.version,
      contributionId: entry.contributionId,
      topics: contribution.config.topics,
    };
  }

  private removeMatchingSubscriptions(
    request: PluginContributionCleanupRequest,
  ): PluginEventSubscriptionProjectionResult[] {
    const removed: PluginEventSubscriptionProjectionResult[] = [];

    for (const [key, subscription] of this.subscriptions.entries()) {
      const pluginMatches = subscription.pluginId === request.pluginId;
      const versionMatches =
        request.version === undefined ||
        subscription.version === request.version;
      if (!pluginMatches || !versionMatches) {
        continue;
      }

      this.subscriptions.delete(key);
      removed.push({
        status: 'cleaned',
        pluginId: subscription.pluginId,
        version: subscription.version,
        contributionId: subscription.contributionId,
        topics: [...subscription.topics],
      });
    }

    return removed;
  }

  private toSubscription(
    pluginId: string,
    version: string,
    contribution: EventSubscriptionContribution,
  ): PluginEventSubscription {
    return {
      pluginId,
      version,
      contributionId: contribution.id,
      operation: contribution.config.operation,
      topics: contribution.config.topics,
      filters: contribution.config.filters,
      deliveryMode: contribution.config.deliveryMode ?? 'non_blocking',
      retry: {
        maxAttempts: contribution.config.retry?.maxAttempts ?? 3,
        initialDelayMs: contribution.config.retry?.initialDelayMs ?? 1_000,
        backoffMultiplier: contribution.config.retry?.backoffMultiplier ?? 2,
      },
      deadLetter: contribution.config.deadLetter,
      requiredPermissions: contribution.config.requiredPermissions,
      contribution,
    };
  }

  private matchesFilters(
    filters: Record<string, unknown> | undefined,
    payload: Record<string, unknown> | undefined,
  ): boolean {
    if (!filters) {
      return true;
    }

    if (!payload) {
      return false;
    }

    return Object.entries(filters).every(
      ([key, value]) => payload[key] === value,
    );
  }

  private subscriptionKey(subscription: PluginEventSubscription): string {
    return [
      subscription.pluginId,
      subscription.version,
      subscription.contributionId,
    ].join(':');
  }
}
