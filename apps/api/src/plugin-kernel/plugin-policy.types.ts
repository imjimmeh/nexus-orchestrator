import type {
  PluginIsolationMode,
  PluginLifecycleState,
  PluginManifestContribution,
  PluginPermission,
  PluginTrustLevel,
} from '@nexus/plugin-sdk';

export type PluginPolicyScanStatus = 'not_scanned' | 'passed' | 'failed';

export type PluginPolicyCompatibilityStatus = 'unknown' | 'passed' | 'failed';

export type PluginPolicyRuntimeHealth =
  | 'not_started'
  | 'healthy'
  | 'unhealthy'
  | 'crash_loop';

export type PluginPolicyReasonCode =
  | 'quarantined_trust'
  | 'unsafe_isolation_for_trust_level'
  | 'unsafe_isolation_override_required'
  | 'scan_required'
  | 'compatibility_failed'
  | 'plugin_disabled'
  | 'runtime_unhealthy'
  | 'permission_not_granted'
  | 'network_host_not_granted'
  | 'contribution_not_declared'
  | 'unsupported_contribution_operation'
  | 'event_topic_not_approved'
  | 'event_subscription_not_declared'
  | 'event_topic_not_subscribed'
  | 'event_namespace_not_owned'
  | 'capability_endpoint_not_declared'
  | 'capability_endpoint_visibility_denied';

export type PluginPolicyDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reasonCode: PluginPolicyReasonCode;
      readonly message: string;
    };

export interface PluginPolicyContext {
  readonly pluginId: string;
  readonly version: string;
  readonly trustLevel: PluginTrustLevel;
  readonly isolationMode: PluginIsolationMode;
  readonly lifecycleState: PluginLifecycleState;
  readonly enabled: boolean;
  readonly requestedPermissions: readonly PluginPermission[];
  readonly grantedPermissions: readonly PluginPermission[];
  readonly contributions: readonly PluginManifestContribution[];
  readonly scanStatus: PluginPolicyScanStatus;
  readonly compatibilityStatus: PluginPolicyCompatibilityStatus;
  readonly runtimeHealth: PluginPolicyRuntimeHealth;
  readonly approvedUnsafeIsolation?: boolean;
  readonly supportedContributionOperations?: Readonly<
    Record<string, readonly string[]>
  >;
}

export interface PluginPolicyInstallInput {
  readonly context: PluginPolicyContext;
  readonly selectedIsolationMode: PluginIsolationMode;
}

export interface PluginPolicyEnableInput {
  readonly context: PluginPolicyContext;
}

export interface PluginPolicyRuntimeStartInput {
  readonly context: PluginPolicyContext;
}

export interface PluginPolicyRuntimeInvocationInput {
  readonly context: PluginPolicyContext;
  readonly contributionId: string;
  readonly operation: string;
}

export interface PluginPolicyEventDeliveryInput {
  readonly context: PluginPolicyContext;
  readonly topic: string;
  readonly contributionId?: string;
  readonly requiredPermissions?: readonly string[];
}

export interface PluginPolicySecretAccessInput {
  readonly context: PluginPolicyContext;
  readonly secretName: string;
}

export interface PluginPolicyStorageAccessInput {
  readonly context: PluginPolicyContext;
  readonly path: string;
  readonly access: 'read' | 'write';
}

export interface PluginPolicyNetworkAccessInput {
  readonly context: PluginPolicyContext;
  readonly host: string;
}

export interface PluginPolicyCapabilityEndpointInvocationInput {
  readonly context: PluginPolicyContext;
  readonly contributionId: string;
  readonly operation: string;
  readonly callerFamily: 'workflow' | 'tool' | 'internal' | 'plugin';
  readonly visibility: readonly ('workflow' | 'tool' | 'internal' | 'plugin')[];
  readonly requiredPermissions?: readonly string[];
}
