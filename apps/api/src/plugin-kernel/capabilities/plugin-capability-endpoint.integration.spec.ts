import { describe, expect, it, vi } from 'vitest';
import type { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import type { PluginPolicyService } from '../plugin-policy.service';
import type { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import type { PluginCapabilityEndpointRegistryService } from './plugin-capability-endpoint-registry.service';
import type { PluginCapabilityEndpoint } from './plugin-capability-endpoint.types';
import type { PluginRuntimeOperationResult } from '../runtime/plugin-runtime.types';
import type { PluginPolicyDecision } from '../plugin-policy.types';
import { PluginCapabilityEndpointInvocationService } from './plugin-capability-endpoint-invocation.service';

// ---------------------------------------------------------------------------
// Shared test data factories
// ---------------------------------------------------------------------------

function buildEndpoint(
  overrides: Partial<PluginCapabilityEndpoint> = {},
): PluginCapabilityEndpoint {
  return {
    pluginId: 'com.acme.audit-plugin',
    version: '1.0.0',
    contributionId: 'audit-endpoint',
    globalEndpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
    displayName: 'Audit Endpoint',
    description: 'Records audit events',
    inputSchema: {
      type: 'object',
      properties: {
        eventType: { type: 'string' },
        userId: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['eventType', 'userId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        recorded: { type: 'boolean' },
        timestamp: { type: 'string' },
      },
      additionalProperties: false,
    },
    requiredPermissions: ['internal_capability:plugin.capabilities.audit'],
    operation: 'record_audit',
    timeoutMs: 5000,
    retryable: true,
    visibility: ['workflow', 'internal', 'plugin'],
    ...overrides,
  };
}

function buildRegistryEntry(
  overrides: Partial<{
    plugin_id: string;
    version: string;
    trust_level: string;
    isolation_mode: string;
    lifecycle_state: string;
    enabled: boolean;
    requested_permissions: Array<{ kind: string; capabilities: string[] }>;
    granted_permissions: Array<{ kind: string; capabilities: string[] }>;
    contributions: Array<{
      id: string;
      type: string;
      config?: {
        operation?: string;
        visibility?: string[];
        requiredPermissions?: string[];
      };
    }>;
    scan_result: { status: string };
    compatibility_result: { status: string };
  }> = {},
) {
  return {
    plugin_id: 'com.acme.audit-plugin',
    version: '1.0.0',
    trust_level: 'local_trusted',
    isolation_mode: 'worker_process',
    lifecycle_state: 'enabled',
    enabled: true,
    requested_permissions: [
      {
        kind: 'internal_capability',
        capabilities: ['plugin.capabilities.audit'],
      },
    ],
    granted_permissions: [
      {
        kind: 'internal_capability',
        capabilities: ['plugin.capabilities.audit'],
      },
    ],
    contributions: [
      {
        id: 'audit-endpoint',
        type: 'capability.endpoint',
        config: {
          operation: 'record_audit',
          visibility: ['workflow', 'internal', 'plugin'],
          requiredPermissions: [
            'internal_capability:plugin.capabilities.audit',
          ],
        },
      },
    ],
    scan_result: { status: 'passed' },
    compatibility_result: { status: 'passed' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper assertion functions for discriminated union types
// ---------------------------------------------------------------------------

function assertSuccess(result: { ok: boolean; output?: unknown }) {
  expect(result.ok).toBe(true);
  expect(result.output).toBeDefined();
}

function assertError(
  result: {
    ok: boolean;
    error?: { code: string; message: string; retryable: boolean };
  },
  expected: { code: string; message: string; retryable: boolean },
) {
  expect(result.ok).toBe(false);
  expect(result.error).toEqual(expected);
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createService(
  overrides: {
    endpointRegistry?: Partial<PluginCapabilityEndpointRegistryService>;
    runtimeManager?: Partial<PluginRuntimeManagerService>;
    policyService?: Partial<PluginPolicyService>;
    registryEntries?: Partial<PluginRegistryEntryRepository>;
  } = {},
) {
  const endpointRegistry = {
    findByGlobalEndpointName: vi.fn(),
    listActiveEndpoints: vi.fn(),
    findByPluginContribution: vi.fn(),
    ...overrides.endpointRegistry,
  };

  const runtimeManager = {
    invokePlugin: vi.fn(),
    ...overrides.runtimeManager,
  };

  const policyService = {
    decideCapabilityEndpointInvocation: vi.fn(),
    ...overrides.policyService,
  };

  const registryEntries = {
    findByPluginIdAndVersion: vi.fn(),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginCapabilityEndpointInvocationService', () => {
  describe('successful invocation flow', () => {
    it('allowed workflow caller succeeds', async () => {
      // Arrange
      const endpoint = buildEndpoint();
      const registryEntry = buildRegistryEntry();
      const validInput = { eventType: 'user.login', userId: 'user-42' };
      const expectedOutput = {
        recorded: true,
        timestamp: '2026-06-01T12:00:00.000Z',
      };

      const {
        service,
        endpointRegistry,
        registryEntries,
        policyService,
        runtimeManager,
      } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: true,
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn().mockResolvedValue({
            ok: true,
            output: expectedOutput,
          } satisfies PluginRuntimeOperationResult),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: validInput,
        callerFamily: 'workflow',
        actorId: 'workflow-run-1',
      });

      // Assert - success case
      assertSuccess(result);
      expect((result as { output?: unknown }).output).toEqual(expectedOutput);
      expect(endpointRegistry.findByGlobalEndpointName).toHaveBeenCalledWith(
        'plugin:com.acme.audit-plugin:audit-endpoint',
      );
      expect(registryEntries.findByPluginIdAndVersion).toHaveBeenCalledWith(
        'com.acme.audit-plugin',
        '1.0.0',
      );
      expect(
        policyService.decideCapabilityEndpointInvocation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          contributionId: 'audit-endpoint',
          operation: 'record_audit',
          callerFamily: 'workflow',
        }),
      );
      expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'com.acme.audit-plugin',
          version: '1.0.0',
          contributionId: 'audit-endpoint',
          operation: 'record_audit',
          input: validInput,
          actorId: 'workflow-run-1',
          timeoutMs: 5000,
          metadata: expect.objectContaining({
            callerFamily: 'workflow',
          }),
        }),
      );
    });
  });

  describe('policy enforcement', () => {
    it('denied visibility rejects before runtime invocation', async () => {
      // Arrange
      const endpoint = buildEndpoint({ visibility: ['internal'] }); // Only internal visibility
      const registryEntry = buildRegistryEntry({
        contributions: [
          {
            id: 'audit-endpoint',
            type: 'capability.endpoint',
            config: {
              operation: 'record_audit',
              visibility: ['internal'], // Endpoint restricted to internal callers
            },
          },
        ],
      });

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: false,
            reasonCode: 'capability_endpoint_visibility_denied',
            message:
              'Capability endpoint is not visible to this caller family.',
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn(),
        },
      });

      // Act - workflow caller attempts to invoke
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'test', userId: 'u1' },
        callerFamily: 'workflow',
      });

      // Assert - denied before runtime
      assertError(result, {
        code: 'capability_endpoint_denied',
        message: 'Capability endpoint invocation denied by policy.',
        retryable: false,
      });
      expect(
        policyService.decideCapabilityEndpointInvocation,
      ).toHaveBeenCalled();
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });

    it('missing permission returns safe error', async () => {
      // Arrange
      const endpoint = buildEndpoint();
      // Registry entry has no granted permissions (simulates missing permission)
      const registryEntry = buildRegistryEntry({
        granted_permissions: [],
        contributions: [
          {
            id: 'audit-endpoint',
            type: 'capability.endpoint',
            config: {
              operation: 'record_audit',
              requiredPermissions: [
                'internal_capability:plugin.capabilities.audit',
              ],
            },
          },
        ],
      });

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: false,
            reasonCode: 'permission_not_granted',
            message: 'Required plugin permission was not granted.',
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn(),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'test', userId: 'u1' },
        callerFamily: 'workflow',
      });

      // Assert - safe, normalized error (not raw internal error)
      assertError(result, {
        code: 'capability_endpoint_denied',
        message: 'Capability endpoint invocation denied by policy.',
        retryable: false,
      });
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });
  });

  describe('runtime failure handling', () => {
    it('runtime failure normalizes output to safe error response', async () => {
      // Arrange
      const endpoint = buildEndpoint();
      const registryEntry = buildRegistryEntry();

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: true,
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn().mockResolvedValue({
            ok: false,
            error: {
              code: 'plugin_internal_error',
              message: 'stack trace: db connection secret password=secret123',
              retryable: true,
              details: { internalToken: 'abc-xyz-123' },
            },
          } satisfies PluginRuntimeOperationResult),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'test', userId: 'u1' },
        callerFamily: 'workflow',
      });

      // Assert - runtime errors are normalized to safe output
      assertError(result, {
        code: 'capability_endpoint_runtime_failed',
        message: 'Capability endpoint runtime invocation failed.',
        retryable: true,
      });
      // Verify no internal details leaked (safe normalization)
      const errorResult = result as {
        error?: { message: string; details?: unknown };
      };
      expect(errorResult.error?.message).not.toContain('secret');
      expect(errorResult.error?.details).toBeUndefined();
    });

    it('runtime timeout normalizes to safe error with retryable=true', async () => {
      // Arrange
      const endpoint = buildEndpoint({ retryable: true });
      const registryEntry = buildRegistryEntry();

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: true,
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn().mockResolvedValue({
            ok: false,
            error: {
              code: 'runtime_timeout',
              message: 'Execution timed out after 5000ms',
              retryable: true,
            },
          } satisfies PluginRuntimeOperationResult),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'test', userId: 'u1' },
        callerFamily: 'workflow',
      });

      // Assert
      assertError(result, {
        code: 'capability_endpoint_runtime_failed',
        message: 'Capability endpoint runtime invocation failed.',
        retryable: true,
      });
    });
  });

  describe('schema validation gates', () => {
    it('invalid input schema prevents invocation with validation error', async () => {
      // Arrange
      const endpoint = buildEndpoint();
      // Input has wrong types: eventType should be string (number provided), userId should be string (null provided)
      const invalidInput = { eventType: 123, userId: null };

      const { service, runtimeManager, policyService, registryEntries } =
        createService({
          endpointRegistry: {
            findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
          },
          registryEntries: {
            findByPluginIdAndVersion: vi
              .fn()
              .mockResolvedValue(buildRegistryEntry()),
          },
          policyService: {
            decideCapabilityEndpointInvocation: vi.fn(),
          },
          runtimeManager: {
            invokePlugin: vi.fn(),
          },
        });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: invalidInput,
        callerFamily: 'workflow',
      });

      // Assert - validation gates invocation
      assertError(result, {
        code: 'capability_endpoint_input_invalid',
        message: 'Capability endpoint input did not match schema.',
        retryable: false,
      });
      // Schema validation happens before policy check and runtime invocation
      expect(
        policyService.decideCapabilityEndpointInvocation,
      ).not.toHaveBeenCalled();
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
      expect(registryEntries.findByPluginIdAndVersion).not.toHaveBeenCalled();
    });

    it('missing required field triggers validation error', async () => {
      // Arrange
      const endpoint = buildEndpoint();
      // Missing required 'userId' field
      const invalidInput = { eventType: 'user.login' };

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        runtimeManager: {
          invokePlugin: vi.fn(),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn(),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: invalidInput,
        callerFamily: 'workflow',
      });

      // Assert
      assertError(result, {
        code: 'capability_endpoint_input_invalid',
        message: 'Capability endpoint input did not match schema.',
        retryable: false,
      });
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });

    it('additional properties not allowed by schema triggers validation error', async () => {
      // Arrange
      const endpoint = buildEndpoint();
      // 'extraField' is not defined in schema and additionalProperties is false
      const invalidInput = {
        eventType: 'user.login',
        userId: 'u1',
        extraField: 'disallowed',
      };

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        runtimeManager: {
          invokePlugin: vi.fn(),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn(),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: invalidInput,
        callerFamily: 'workflow',
      });

      // Assert
      assertError(result, {
        code: 'capability_endpoint_input_invalid',
        message: 'Capability endpoint input did not match schema.',
        retryable: false,
      });
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });
  });

  describe('endpoint not found', () => {
    it('returns safe error when endpoint does not exist', async () => {
      // Arrange
      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(null),
        },
        runtimeManager: {
          invokePlugin: vi.fn(),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn(),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:non-existent',
        input: { eventType: 'test', userId: 'u1' },
        callerFamily: 'workflow',
      });

      // Assert
      assertError(result, {
        code: 'capability_endpoint_not_found',
        message: 'Plugin capability endpoint was not found.',
        retryable: false,
      });
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });
  });

  describe('output validation', () => {
    it('validates output schema when present', async () => {
      // Arrange
      const endpoint = buildEndpoint();
      const registryEntry = buildRegistryEntry();
      const validOutput = {
        recorded: true,
        timestamp: '2026-06-01T12:00:00.000Z',
      };

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: true,
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn().mockResolvedValue({
            ok: true,
            output: validOutput,
          } satisfies PluginRuntimeOperationResult),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'test', userId: 'u1' },
        callerFamily: 'workflow',
      });

      // Assert
      assertSuccess(result);
      expect((result as { output?: unknown }).output).toEqual(validOutput);
    });

    it('returns output validation error when output does not match schema', async () => {
      // Arrange
      // Create endpoint with recorded as required field to trigger validation failure
      const endpoint = buildEndpoint({
        outputSchema: {
          type: 'object',
          properties: {
            recorded: { type: 'boolean' },
            timestamp: { type: 'string' },
          },
          required: ['recorded', 'timestamp'],
          additionalProperties: false,
        },
      });
      const registryEntry = buildRegistryEntry();
      // Output missing required 'recorded' boolean field
      const invalidOutput = { timestamp: '2026-06-01T12:00:00.000Z' };

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: true,
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn().mockResolvedValue({
            ok: true,
            output: invalidOutput,
          } satisfies PluginRuntimeOperationResult),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'test', userId: 'u1' },
        callerFamily: 'workflow',
      });

      // Assert
      assertError(result, {
        code: 'capability_endpoint_output_invalid',
        message: 'Capability endpoint output did not match schema.',
        retryable: false,
      });
    });
  });

  describe('tool caller invocation', () => {
    it('tool caller can invoke endpoint with workflow visibility', async () => {
      // Arrange
      const endpoint = buildEndpoint({ visibility: ['workflow', 'tool'] });
      const registryEntry = buildRegistryEntry({
        contributions: [
          {
            id: 'audit-endpoint',
            type: 'capability.endpoint',
            config: {
              operation: 'record_audit',
              visibility: ['workflow', 'tool'],
            },
          },
        ],
      });

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: true,
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn().mockResolvedValue({
            ok: true,
            output: { recorded: true, timestamp: '2026-06-01T12:00:00.000Z' },
          } satisfies PluginRuntimeOperationResult),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'user.logout', userId: 'user-42' },
        callerFamily: 'tool',
        callerId: 'tool-execution-1',
      });

      // Assert
      assertSuccess(result);
      expect(
        policyService.decideCapabilityEndpointInvocation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          callerFamily: 'tool',
        }),
      );
      expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            callerFamily: 'tool',
            callerId: 'tool-execution-1',
          }),
        }),
      );
    });
  });

  describe('internal caller invocation', () => {
    it('internal caller can invoke endpoint with internal visibility', async () => {
      // Arrange
      const endpoint = buildEndpoint({ visibility: ['internal'] });
      const registryEntry = buildRegistryEntry({
        contributions: [
          {
            id: 'audit-endpoint',
            type: 'capability.endpoint',
            config: {
              operation: 'record_audit',
              visibility: ['internal'],
            },
          },
        ],
      });

      const { service, runtimeManager, policyService } = createService({
        endpointRegistry: {
          findByGlobalEndpointName: vi.fn().mockResolvedValue(endpoint),
        },
        registryEntries: {
          findByPluginIdAndVersion: vi.fn().mockResolvedValue(registryEntry),
        },
        policyService: {
          decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
            allowed: true,
          } satisfies PluginPolicyDecision),
        },
        runtimeManager: {
          invokePlugin: vi.fn().mockResolvedValue({
            ok: true,
            output: { recorded: true, timestamp: '2026-06-01T12:00:00.000Z' },
          } satisfies PluginRuntimeOperationResult),
        },
      });

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:com.acme.audit-plugin:audit-endpoint',
        input: { eventType: 'system.alert', userId: 'system' },
        callerFamily: 'internal',
      });

      // Assert
      assertSuccess(result);
      expect(runtimeManager.invokePlugin).toHaveBeenCalled();
    });
  });
});
