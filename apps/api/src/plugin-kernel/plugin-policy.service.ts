import { Injectable, Optional } from '@nestjs/common';
import type { PluginIsolationMode, PluginPermission } from '@nexus/plugin-sdk';
import { PluginEventSubscriptionProjectionService } from './events/plugin-event-subscription-projection.service';
import {
  doesPluginOwnNamespaceTopic,
  isApprovedTopicForPlugin,
  matchesTopicPattern,
} from './events/plugin-event-topic-catalog';
import type {
  PluginPolicyCapabilityEndpointInvocationInput,
  PluginPolicyContext,
  PluginPolicyDecision,
  PluginPolicyEnableInput,
  PluginPolicyEventDeliveryInput,
  PluginPolicyInstallInput,
  PluginPolicyNetworkAccessInput,
  PluginPolicyReasonCode,
  PluginPolicyRuntimeStartInput,
  PluginPolicyRuntimeInvocationInput,
  PluginPolicySecretAccessInput,
  PluginPolicyStorageAccessInput,
} from './plugin-policy.types';

const DENIAL_MESSAGES: Record<PluginPolicyReasonCode, string> = {
  quarantined_trust: 'Quarantined plugins cannot perform this action.',
  unsafe_isolation_for_trust_level:
    'Selected isolation mode is not allowed for this plugin trust level.',
  unsafe_isolation_override_required:
    'Unsafe local plugin isolation requires an explicit operator override.',
  scan_required: 'Plugin must pass scan before this action is allowed.',
  compatibility_failed:
    'Plugin compatibility must pass before this action is allowed.',
  plugin_disabled: 'Plugin must be enabled before this action is allowed.',
  runtime_unhealthy: 'Plugin runtime is not healthy enough for this action.',
  permission_not_granted: 'Required plugin permission was not granted.',
  network_host_not_granted:
    'Network host is not included in granted plugin permissions.',
  contribution_not_declared: 'Contribution is not declared by this plugin.',
  unsupported_contribution_operation:
    'Contribution operation is not supported by this plugin policy.',
  event_topic_not_approved: 'Event topic is not approved by plugin policy.',
  event_subscription_not_declared:
    'Event subscription contribution is not declared for this plugin.',
  event_topic_not_subscribed:
    'Event topic is not covered by the subscription topic patterns.',
  event_namespace_not_owned:
    'Plugin cannot receive extension events for another plugin namespace.',
  capability_endpoint_not_declared:
    'Capability endpoint contribution is not declared for this plugin.',
  capability_endpoint_visibility_denied:
    'Capability endpoint is not visible to this caller family.',
};

@Injectable()
export class PluginPolicyService {
  constructor(
    @Optional()
    private readonly subscriptions?: PluginEventSubscriptionProjectionService,
  ) {}

  decideInstall(input: PluginPolicyInstallInput): PluginPolicyDecision {
    const trustDecision = this.decideTrust(input.context);
    if (!trustDecision.allowed) return trustDecision;

    return this.decideIsolation(input.context, input.selectedIsolationMode);
  }

  decideEnable(input: PluginPolicyEnableInput): PluginPolicyDecision {
    const safetyDecision = this.decideStaticSafety(input.context);
    if (!safetyDecision.allowed) return safetyDecision;

    return this.decideIsolation(input.context, input.context.isolationMode);
  }

  decideRuntimeStart(
    input: PluginPolicyRuntimeStartInput,
  ): PluginPolicyDecision {
    return this.decideRuntimeActivity(input.context);
  }

  decideRuntimeInvocation(
    input: PluginPolicyRuntimeInvocationInput,
  ): PluginPolicyDecision {
    const activityDecision = this.decideRuntimeActivity(input.context);
    if (!activityDecision.allowed) return activityDecision;

    if (
      !input.context.contributions.some(
        (contribution) => contribution.id === input.contributionId,
      )
    ) {
      return this.deny('contribution_not_declared');
    }

    const supportedOperations =
      input.context.supportedContributionOperations?.[input.contributionId] ??
      [];
    if (!supportedOperations.includes(input.operation)) {
      return this.deny('unsupported_contribution_operation');
    }

    return this.allow();
  }

  decideCapabilityEndpointInvocation(
    input: PluginPolicyCapabilityEndpointInvocationInput,
  ): PluginPolicyDecision {
    const activityDecision = this.decideRuntimeActivity(input.context);
    if (!activityDecision.allowed) return activityDecision;

    const hasContribution = input.context.contributions.some(
      (contribution) =>
        contribution.id === input.contributionId &&
        contribution.type === 'capability.endpoint',
    );
    if (!hasContribution) {
      return this.deny('capability_endpoint_not_declared');
    }

    const supportedOperations =
      input.context.supportedContributionOperations?.[input.contributionId] ??
      [];
    if (!supportedOperations.includes(input.operation)) {
      return this.deny('unsupported_contribution_operation');
    }

    if (!input.visibility.includes(input.callerFamily)) {
      return this.deny('capability_endpoint_visibility_denied');
    }

    if (
      !this.hasRequiredCapabilityPermissions(
        input.context,
        input.requiredPermissions ?? [],
      )
    ) {
      return this.deny('permission_not_granted');
    }

    return this.allow();
  }

  decideEventDelivery(
    input: PluginPolicyEventDeliveryInput,
  ): PluginPolicyDecision {
    const activityDecision = this.decideRuntimeActivity(input.context);
    if (!activityDecision.allowed) return activityDecision;

    if (!isApprovedTopicForPlugin(input.topic, input.context.pluginId)) {
      return this.deny('event_topic_not_approved');
    }

    if (
      input.topic.startsWith('plugin.') &&
      !doesPluginOwnNamespaceTopic(input.context.pluginId, input.topic)
    ) {
      return this.deny('event_namespace_not_owned');
    }

    if (input.contributionId) {
      if (!this.subscriptions) {
        return this.deny('event_subscription_not_declared');
      }

      const subscription = this.subscriptions
        .listActiveSubscriptions()
        .find(
          (candidate) =>
            candidate.pluginId === input.context.pluginId &&
            candidate.version === input.context.version &&
            candidate.contributionId === input.contributionId,
        );
      if (!subscription) {
        return this.deny('event_subscription_not_declared');
      }

      const topicCovered = subscription.topics.some((topicPattern) =>
        matchesTopicPattern(topicPattern, input.topic),
      );
      if (!topicCovered) {
        return this.deny('event_topic_not_subscribed');
      }

      const requiredPermissions = input.requiredPermissions ?? [];
      if (
        !this.hasRequiredCapabilityPermissions(
          input.context,
          requiredPermissions,
        )
      ) {
        return this.deny('permission_not_granted');
      }
    }

    return this.allow();
  }

  decideSecretAccess(
    input: PluginPolicySecretAccessInput,
  ): PluginPolicyDecision {
    const activityDecision = this.decideRuntimeActivity(input.context);
    if (!activityDecision.allowed) return activityDecision;

    return this.hasGrantedPermission(input.context, (permission) => {
      return (
        permission.kind === 'secrets' &&
        permission.names.includes(input.secretName)
      );
    })
      ? this.allow()
      : this.deny('permission_not_granted');
  }

  decideStorageAccess(
    input: PluginPolicyStorageAccessInput,
  ): PluginPolicyDecision {
    const activityDecision = this.decideRuntimeActivity(input.context);
    if (!activityDecision.allowed) return activityDecision;

    return this.hasGrantedPermission(input.context, (permission) => {
      return (
        permission.kind === 'filesystem' &&
        permission.access === input.access &&
        permission.paths.some((allowedPath) =>
          this.pathCovers(allowedPath, input.path),
        )
      );
    })
      ? this.allow()
      : this.deny('permission_not_granted');
  }

  decideNetworkAccess(
    input: PluginPolicyNetworkAccessInput,
  ): PluginPolicyDecision {
    const activityDecision = this.decideRuntimeActivity(input.context);
    if (!activityDecision.allowed) return activityDecision;

    return this.hasGrantedPermission(input.context, (permission) => {
      return (
        permission.kind === 'network' &&
        permission.hosts.some((allowedHost) =>
          this.hostMatches(allowedHost, input.host),
        )
      );
    })
      ? this.allow()
      : this.deny('network_host_not_granted');
  }

  private decideRuntimeActivity(
    context: PluginPolicyContext,
  ): PluginPolicyDecision {
    const safetyDecision = this.decideStaticSafety(context);
    if (!safetyDecision.allowed) return safetyDecision;

    if (!context.enabled || context.lifecycleState !== 'enabled') {
      return this.deny('plugin_disabled');
    }

    if (context.runtimeHealth !== 'healthy') {
      return this.deny('runtime_unhealthy');
    }

    return this.allow();
  }

  private decideStaticSafety(
    context: PluginPolicyContext,
  ): PluginPolicyDecision {
    const trustDecision = this.decideTrust(context);
    if (!trustDecision.allowed) return trustDecision;

    if (context.scanStatus !== 'passed') {
      return this.deny('scan_required');
    }

    if (context.compatibilityStatus !== 'passed') {
      return this.deny('compatibility_failed');
    }

    return this.decideIsolation(context, context.isolationMode);
  }

  private decideTrust(context: PluginPolicyContext): PluginPolicyDecision {
    return context.trustLevel === 'quarantined'
      ? this.deny('quarantined_trust')
      : this.allow();
  }

  private decideIsolation(
    context: PluginPolicyContext,
    isolationMode: PluginIsolationMode,
  ): PluginPolicyDecision {
    if (isolationMode !== 'none') {
      return this.allow();
    }

    if (context.trustLevel === 'bundled') {
      return this.allow();
    }

    if (context.trustLevel === 'local_trusted') {
      return context.approvedUnsafeIsolation === true
        ? this.allow()
        : this.deny('unsafe_isolation_override_required');
    }

    return this.deny('unsafe_isolation_for_trust_level');
  }

  private hasGrantedPermission(
    context: PluginPolicyContext,
    predicate: (permission: PluginPermission) => boolean,
  ): boolean {
    return context.grantedPermissions.some(predicate);
  }

  private hasRequiredCapabilityPermissions(
    context: PluginPolicyContext,
    requiredPermissions: readonly string[],
  ): boolean {
    if (requiredPermissions.length === 0) {
      return true;
    }

    const grantedInternalCapabilities = context.grantedPermissions
      .filter(
        (
          permission,
        ): permission is Extract<
          PluginPermission,
          { kind: 'internal_capability' }
        > => permission.kind === 'internal_capability',
      )
      .flatMap((permission) => permission.capabilities);

    return requiredPermissions.every((requiredPermission) => {
      const normalized = requiredPermission.startsWith('internal_capability:')
        ? requiredPermission.slice('internal_capability:'.length)
        : requiredPermission;
      return grantedInternalCapabilities.includes(normalized);
    });
  }

  private hostMatches(allowedHost: string, requestedHost: string): boolean {
    if (allowedHost === '*') {
      return true;
    }

    if (allowedHost.startsWith('*.')) {
      return requestedHost.endsWith(allowedHost.slice(1));
    }

    return allowedHost === requestedHost;
  }

  private pathCovers(allowedPath: string, requestedPath: string): boolean {
    const normalizedAllowedPath = this.normalizePath(allowedPath);
    const normalizedRequestedPath = this.normalizePath(requestedPath);

    return (
      normalizedRequestedPath === normalizedAllowedPath ||
      normalizedRequestedPath.startsWith(`${normalizedAllowedPath}/`)
    );
  }

  private normalizePath(path: string): string {
    const normalizedPath = path.replaceAll('\\', '/');
    const hasRoot = normalizedPath.startsWith('/');
    const segments: string[] = [];

    for (const segment of normalizedPath.split('/')) {
      if (segment === '' || segment === '.') {
        continue;
      }

      if (segment === '..') {
        if (segments.length > 0 && segments[segments.length - 1] !== '..') {
          segments.pop();
          continue;
        }

        if (!hasRoot) {
          segments.push(segment);
        }

        continue;
      }

      segments.push(segment);
    }

    const canonicalPath = segments.join('/');
    return hasRoot ? `/${canonicalPath}` : canonicalPath;
  }

  private allow(): PluginPolicyDecision {
    return { allowed: true };
  }

  private deny(reasonCode: PluginPolicyReasonCode): PluginPolicyDecision {
    return {
      allowed: false,
      reasonCode,
      message: DENIAL_MESSAGES[reasonCode],
    };
  }
}
