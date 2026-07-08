import { Test } from '@nestjs/testing';
import type {
  PluginManifestContribution,
  PluginPermission,
} from '@nexus/plugin-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { PluginEventSubscriptionProjectionService } from './events/plugin-event-subscription-projection.service';
import { PluginPolicyService } from './plugin-policy.service';
import type { PluginPolicyContext } from './plugin-policy.types';

const networkPermission: PluginPermission = {
  kind: 'network',
  hosts: ['api.acme.test'],
};

const secretPermission: PluginPermission = {
  kind: 'secrets',
  names: ['acme-api-token'],
};

const storagePermission: PluginPermission = {
  kind: 'filesystem',
  access: 'read',
  paths: ['/workspace/plugins/acme'],
};

const workflowToolContribution: PluginManifestContribution = {
  id: 'summarize',
  type: 'tool',
  displayName: 'Summarize',
  config: {
    inputSchema: { type: 'object' },
    operation: 'execute',
  },
};

const capabilityEndpointContribution: PluginManifestContribution = {
  id: 'audit-endpoint',
  type: 'capability.endpoint',
  displayName: 'Audit Endpoint',
  config: {
    inputSchema: { type: 'object' },
    operation: 'invoke_audit',
    visibility: ['workflow'],
  },
};

function buildPolicyContext(
  overrides: Partial<PluginPolicyContext> = {},
): PluginPolicyContext {
  return {
    pluginId: 'com.acme.workflow-tools',
    version: '1.2.3',
    trustLevel: 'third_party',
    isolationMode: 'worker_process',
    lifecycleState: 'enabled',
    enabled: true,
    requestedPermissions: [
      networkPermission,
      secretPermission,
      storagePermission,
    ],
    grantedPermissions: [
      networkPermission,
      secretPermission,
      storagePermission,
    ],
    contributions: [workflowToolContribution],
    scanStatus: 'passed',
    compatibilityStatus: 'passed',
    runtimeHealth: 'healthy',
    approvedUnsafeIsolation: false,
    supportedContributionOperations: {
      summarize: ['invoke'],
    },
    ...overrides,
  };
}

describe('PluginPolicyService', () => {
  let service: PluginPolicyService;
  let subscriptions: {
    listActiveSubscriptions: () => Array<Record<string, unknown>>;
  };

  beforeEach(async () => {
    subscriptions = {
      listActiveSubscriptions: () =>
        [
          {
            pluginId: 'com.acme.workflow-tools',
            version: '1.2.3',
            contributionId: 'event-delivery',
            topics: ['workflow.run.completed.v1'],
          },
        ] satisfies Array<Record<string, unknown>>,
    };

    const module = await Test.createTestingModule({
      providers: [
        PluginPolicyService,
        {
          provide: PluginEventSubscriptionProjectionService,
          useValue: subscriptions,
        },
      ],
    }).compile();

    service = module.get(PluginPolicyService);
  });

  it('allows installing a scanned-compatible third-party plugin with worker isolation', () => {
    const result = service.decideInstall({
      context: buildPolicyContext({
        lifecycleState: 'discovered',
        enabled: false,
      }),
      selectedIsolationMode: 'worker_process',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('denies installing third-party plugins with none isolation', () => {
    const result = service.decideInstall({
      context: buildPolicyContext({
        lifecycleState: 'discovered',
        enabled: false,
        isolationMode: 'none',
      }),
      selectedIsolationMode: 'none',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'unsafe_isolation_for_trust_level',
      message:
        'Selected isolation mode is not allowed for this plugin trust level.',
    });
  });

  it('denies installing local trusted plugins with none isolation without explicit override', () => {
    const result = service.decideInstall({
      context: buildPolicyContext({
        lifecycleState: 'discovered',
        enabled: false,
        trustLevel: 'local_trusted',
        isolationMode: 'none',
      }),
      selectedIsolationMode: 'none',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'unsafe_isolation_override_required',
      message:
        'Unsafe local plugin isolation requires an explicit operator override.',
    });
  });

  it('allows installing local trusted plugins with none isolation when explicitly approved', () => {
    const result = service.decideInstall({
      context: buildPolicyContext({
        lifecycleState: 'discovered',
        enabled: false,
        trustLevel: 'local_trusted',
        isolationMode: 'none',
        approvedUnsafeIsolation: true,
      }),
      selectedIsolationMode: 'none',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('denies installing quarantined plugins', () => {
    const result = service.decideInstall({
      context: buildPolicyContext({
        lifecycleState: 'discovered',
        enabled: false,
        trustLevel: 'quarantined',
      }),
      selectedIsolationMode: 'worker_process',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'quarantined_trust',
      message: 'Quarantined plugins cannot perform this action.',
    });
  });

  it('allows enabling scanned compatible plugins with safe isolation', () => {
    const result = service.decideEnable({ context: buildPolicyContext() });

    expect(result).toEqual({ allowed: true });
  });

  it('denies enabling unscanned plugins', () => {
    const result = service.decideEnable({
      context: buildPolicyContext({ scanStatus: 'not_scanned' }),
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'scan_required',
      message: 'Plugin must pass scan before this action is allowed.',
    });
  });

  it('allows runtime invocation for enabled healthy plugins and supported operations', () => {
    const result = service.decideRuntimeInvocation({
      context: buildPolicyContext(),
      contributionId: 'summarize',
      operation: 'invoke',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('allows runtime startup for enabled healthy plugins', () => {
    const result = service.decideRuntimeStart({
      context: buildPolicyContext(),
    });

    expect(result).toEqual({ allowed: true });
  });

  it('denies runtime startup for disabled plugins', () => {
    const result = service.decideRuntimeStart({
      context: buildPolicyContext({
        enabled: false,
        lifecycleState: 'disabled',
      }),
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'plugin_disabled',
      message: 'Plugin must be enabled before this action is allowed.',
    });
  });

  it('denies runtime invocation for disabled plugins', () => {
    const result = service.decideRuntimeInvocation({
      context: buildPolicyContext({
        enabled: false,
        lifecycleState: 'disabled',
      }),
      contributionId: 'summarize',
      operation: 'invoke',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'plugin_disabled',
      message: 'Plugin must be enabled before this action is allowed.',
    });
  });

  it('denies runtime invocation for unsupported contribution operations', () => {
    const result = service.decideRuntimeInvocation({
      context: buildPolicyContext(),
      contributionId: 'summarize',
      operation: 'delete-workflow',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'unsupported_contribution_operation',
      message: 'Contribution operation is not supported by this plugin policy.',
    });
  });

  it('allows event delivery for enabled healthy plugins', () => {
    const result = service.decideEventDelivery({
      context: buildPolicyContext(),
      topic: 'workflow.run.completed.v1',
      contributionId: 'event-delivery',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('allows capability endpoint invocation for workflow callers', () => {
    const result = service.decideCapabilityEndpointInvocation({
      context: buildPolicyContext({
        contributions: [
          workflowToolContribution,
          capabilityEndpointContribution,
        ],
        supportedContributionOperations: {
          summarize: ['invoke'],
          'audit-endpoint': ['invoke_audit'],
        },
        grantedPermissions: [
          {
            kind: 'internal_capability',
            capabilities: ['plugin.endpoint.invoke'],
          },
        ],
      }),
      contributionId: 'audit-endpoint',
      operation: 'invoke_audit',
      callerFamily: 'workflow',
      visibility: ['workflow'],
      requiredPermissions: ['internal_capability:plugin.endpoint.invoke'],
    });

    expect(result).toEqual({ allowed: true });
  });

  it('denies capability endpoint invocation when visibility disallows caller', () => {
    const result = service.decideCapabilityEndpointInvocation({
      context: buildPolicyContext({
        contributions: [
          workflowToolContribution,
          capabilityEndpointContribution,
        ],
        supportedContributionOperations: {
          summarize: ['invoke'],
          'audit-endpoint': ['invoke_audit'],
        },
      }),
      contributionId: 'audit-endpoint',
      operation: 'invoke_audit',
      callerFamily: 'tool',
      visibility: ['workflow'],
      requiredPermissions: [],
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'capability_endpoint_visibility_denied',
      message: 'Capability endpoint is not visible to this caller family.',
    });
  });

  it('denies capability endpoint invocation when required permission is missing', () => {
    const result = service.decideCapabilityEndpointInvocation({
      context: buildPolicyContext({
        contributions: [
          workflowToolContribution,
          capabilityEndpointContribution,
        ],
        supportedContributionOperations: {
          summarize: ['invoke'],
          'audit-endpoint': ['invoke_audit'],
        },
        grantedPermissions: [
          {
            kind: 'internal_capability',
            capabilities: ['plugin.events.basic'],
          },
        ],
      }),
      contributionId: 'audit-endpoint',
      operation: 'invoke_audit',
      callerFamily: 'workflow',
      visibility: ['workflow'],
      requiredPermissions: ['internal_capability:plugin.endpoint.invoke'],
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
  });

  it('denies capability endpoint invocation for inactive plugins', () => {
    const result = service.decideCapabilityEndpointInvocation({
      context: buildPolicyContext({
        enabled: false,
        lifecycleState: 'disabled',
        contributions: [
          workflowToolContribution,
          capabilityEndpointContribution,
        ],
        supportedContributionOperations: {
          summarize: ['invoke'],
          'audit-endpoint': ['invoke_audit'],
        },
      }),
      contributionId: 'audit-endpoint',
      operation: 'invoke_audit',
      callerFamily: 'workflow',
      visibility: ['workflow'],
      requiredPermissions: [],
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'plugin_disabled',
      message: 'Plugin must be enabled before this action is allowed.',
    });
  });

  it('denies event delivery when the topic is not approved', () => {
    const result = service.decideEventDelivery({
      context: buildPolicyContext(),
      topic: 'workflow.run.cancelled.v1',
      contributionId: 'event-delivery',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'event_topic_not_approved',
      message: 'Event topic is not approved by plugin policy.',
    });
  });

  it('denies event delivery when subscription contribution is missing', () => {
    const result = service.decideEventDelivery({
      context: buildPolicyContext(),
      topic: 'workflow.run.completed.v1',
      contributionId: 'missing-subscription',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'event_subscription_not_declared',
      message:
        'Event subscription contribution is not declared for this plugin.',
    });
  });

  it('denies plugin extension topic namespace impersonation', () => {
    const result = service.decideEventDelivery({
      context: buildPolicyContext(),
      topic: 'plugin.other-plugin.event.created',
      contributionId: 'event-delivery',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'event_topic_not_approved',
      message: 'Event topic is not approved by plugin policy.',
    });
  });

  it('denies event delivery when required permission is missing', () => {
    const result = service.decideEventDelivery({
      context: buildPolicyContext({
        grantedPermissions: [
          {
            kind: 'internal_capability',
            capabilities: ['plugin.events.basic'],
          },
        ],
      }),
      topic: 'workflow.run.completed.v1',
      contributionId: 'event-delivery',
      requiredPermissions: ['internal_capability:plugin.events.receive'],
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
  });

  it('denies event delivery to plugins in a crash loop', () => {
    const result = service.decideEventDelivery({
      context: buildPolicyContext({ runtimeHealth: 'crash_loop' }),
      topic: 'workflow.completed',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'runtime_unhealthy',
      message: 'Plugin runtime is not healthy enough for this action.',
    });
  });

  it('allows secret access when the named secret permission is granted', () => {
    const result = service.decideSecretAccess({
      context: buildPolicyContext(),
      secretName: 'acme-api-token',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('denies secret access when the named secret permission is not granted', () => {
    const result = service.decideSecretAccess({
      context: buildPolicyContext({ grantedPermissions: [networkPermission] }),
      secretName: 'acme-api-token',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
  });

  it('allows storage access when the filesystem permission covers the path and access mode', () => {
    const result = service.decideStorageAccess({
      context: buildPolicyContext(),
      path: '/workspace/plugins/acme/cache.json',
      access: 'read',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('denies storage access when the filesystem permission is not granted', () => {
    const result = service.decideStorageAccess({
      context: buildPolicyContext({ grantedPermissions: [networkPermission] }),
      path: '/workspace/plugins/acme/cache.json',
      access: 'read',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
  });

  it('denies storage access when traversal escapes the granted subtree', () => {
    const result = service.decideStorageAccess({
      context: buildPolicyContext(),
      path: '/workspace/plugins/acme/../other/secret.json',
      access: 'read',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
  });

  it('denies storage access for sibling paths with the same prefix', () => {
    const result = service.decideStorageAccess({
      context: buildPolicyContext(),
      path: '/workspace/plugins/acme-other/file.json',
      access: 'read',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
  });

  it('denies storage access when Windows backslash traversal escapes the grant', () => {
    const result = service.decideStorageAccess({
      context: buildPolicyContext(),
      path: '\\workspace\\plugins\\acme\\..\\other\\secret.json',
      access: 'read',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
  });

  it('allows storage access when duplicated separators and dot segments stay inside the grant', () => {
    const result = service.decideStorageAccess({
      context: buildPolicyContext(),
      path: '/workspace//plugins/acme/./nested//cache.json',
      access: 'read',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('allows network access when the host is granted', () => {
    const result = service.decideNetworkAccess({
      context: buildPolicyContext(),
      host: 'api.acme.test',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('denies network access when the requested host does not match a grant', () => {
    const result = service.decideNetworkAccess({
      context: buildPolicyContext(),
      host: 'metadata.google.internal',
    });

    expect(result).toEqual({
      allowed: false,
      reasonCode: 'network_host_not_granted',
      message: 'Network host is not included in granted plugin permissions.',
    });
  });
});
