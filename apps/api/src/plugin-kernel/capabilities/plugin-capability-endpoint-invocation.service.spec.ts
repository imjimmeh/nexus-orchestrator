import { describe, expect, it, vi } from 'vitest';
import type { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import type { PluginPolicyService } from '../plugin-policy.service';
import type { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import type { PluginCapabilityEndpointRegistryService } from './plugin-capability-endpoint-registry.service';
import { PluginCapabilityEndpointInvocationService } from './plugin-capability-endpoint-invocation.service';

function createEndpoint() {
  return {
    pluginId: 'acme.plugin',
    version: '1.0.0',
    contributionId: 'audit-endpoint',
    globalEndpointName: 'plugin:acme.plugin:audit-endpoint',
    displayName: 'Audit Endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
      required: ['value'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
    },
    requiredPermissions: ['internal_capability:plugin.endpoint.invoke'],
    operation: 'invoke_audit',
    timeoutMs: 15_000,
    retryable: true,
    visibility: ['workflow', 'tool'] as const,
  };
}

function createRegistryEntry() {
  return {
    plugin_id: 'acme.plugin',
    version: '1.0.0',
    trust_level: 'third_party',
    isolation_mode: 'worker_process',
    lifecycle_state: 'enabled',
    enabled: true,
    requested_permissions: [],
    granted_permissions: [
      {
        kind: 'internal_capability',
        capabilities: ['plugin.endpoint.invoke'],
      },
    ],
    contributions: [
      {
        id: 'audit-endpoint',
        type: 'capability.endpoint',
        config: {
          operation: 'invoke_audit',
        },
      },
    ],
    scan_result: { status: 'passed' },
    compatibility_result: { status: 'passed' },
  };
}

function createService(
  overrides: {
    endpointRegistry?: Partial<PluginCapabilityEndpointRegistryService>;
    runtimeManager?: Partial<PluginRuntimeManagerService>;
    policyService?: Partial<PluginPolicyService>;
    registryEntries?: Partial<PluginRegistryEntryRepository>;
  } = {},
) {
  const endpointRegistry = {
    findByGlobalEndpointName: vi.fn().mockResolvedValue(createEndpoint()),
    ...overrides.endpointRegistry,
  };
  const runtimeManager = {
    invokePlugin: vi.fn().mockResolvedValue({ ok: true, output: { ok: true } }),
    ...overrides.runtimeManager,
  };
  const policyService = {
    decideCapabilityEndpointInvocation: vi
      .fn()
      .mockReturnValue({ allowed: true }),
    ...overrides.policyService,
  };
  const registryEntries = {
    findByPluginIdAndVersion: vi.fn().mockResolvedValue(createRegistryEntry()),
    ...overrides.registryEntries,
  };

  return {
    service: new PluginCapabilityEndpointInvocationService(
      endpointRegistry as unknown as PluginCapabilityEndpointRegistryService,
      runtimeManager as unknown as PluginRuntimeManagerService,
      policyService as unknown as PluginPolicyService,
      registryEntries as unknown as PluginRegistryEntryRepository,
    ),
    endpointRegistry,
    runtimeManager,
    policyService,
    registryEntries,
  };
}

describe('PluginCapabilityEndpointInvocationService', () => {
  it('invokes a capability endpoint successfully', async () => {
    const { service, runtimeManager } = createService();

    const result = await service.invoke({
      endpointName: 'plugin:acme.plugin:audit-endpoint',
      input: { value: 'x' },
      callerFamily: 'workflow',
    });

    expect(result).toEqual({ ok: true, output: { ok: true } });
    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        contributionId: 'audit-endpoint',
        operation: 'invoke_audit',
      }),
    );
  });

  it('returns input validation failures', async () => {
    const { service } = createService();

    const result = await service.invoke({
      endpointName: 'plugin:acme.plugin:audit-endpoint',
      input: { wrong: 'shape' },
      callerFamily: 'workflow',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'capability_endpoint_input_invalid',
        message: 'Capability endpoint input did not match schema.',
        retryable: false,
      },
    });
  });

  it('returns output validation failures', async () => {
    const { service } = createService({
      runtimeManager: {
        invokePlugin: vi
          .fn()
          .mockResolvedValue({ ok: true, output: { invalid: true } }),
      },
    });

    const result = await service.invoke({
      endpointName: 'plugin:acme.plugin:audit-endpoint',
      input: { value: 'x' },
      callerFamily: 'workflow',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'capability_endpoint_output_invalid',
        message: 'Capability endpoint output did not match schema.',
        retryable: false,
      },
    });
  });

  it('returns not-found errors for missing endpoints', async () => {
    const { service } = createService({
      endpointRegistry: {
        findByGlobalEndpointName: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await service.invoke({
      endpointName: 'plugin:missing:endpoint',
      input: { value: 'x' },
      callerFamily: 'workflow',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'capability_endpoint_not_found',
        message: 'Plugin capability endpoint was not found.',
        retryable: false,
      },
    });
  });

  it('returns policy denial errors', async () => {
    const { service } = createService({
      policyService: {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: false,
          reasonCode: 'capability_endpoint_visibility_denied',
          message: 'Capability endpoint is not visible to this caller family.',
        }),
      },
    });

    const result = await service.invoke({
      endpointName: 'plugin:acme.plugin:audit-endpoint',
      input: { value: 'x' },
      callerFamily: 'internal',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'capability_endpoint_denied',
        message: 'Capability endpoint invocation denied by policy.',
        retryable: false,
      },
    });
  });

  it('normalizes runtime failures', async () => {
    const { service } = createService({
      runtimeManager: {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'runtime_timeout',
            message: 'Plugin runtime call timed out.',
            retryable: true,
          },
        }),
      },
    });

    const result = await service.invoke({
      endpointName: 'plugin:acme.plugin:audit-endpoint',
      input: { value: 'x' },
      callerFamily: 'workflow',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'capability_endpoint_runtime_failed',
        message: 'Capability endpoint runtime invocation failed.',
        retryable: true,
      },
    });
  });

  it('uses configured endpoint operation for runtime invocation', async () => {
    const { service, runtimeManager } = createService({
      endpointRegistry: {
        findByGlobalEndpointName: vi.fn().mockResolvedValue(createEndpoint()),
      },
    });

    await service.invoke({
      endpointName: 'plugin:acme.plugin:audit-endpoint',
      input: { value: 'x' },
      callerFamily: 'workflow',
    });

    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'invoke_audit' }),
    );
  });
});
