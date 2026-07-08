import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Integration tests for Plugin Capability Endpoint invocation.
 *
 * These tests define the acceptance criteria for `capability.endpoint` invocation
 * as specified in EPIC-192 design doc, including:
 * - Input schema validation
 * - Policy check (visibility + permissions)
 * - Runtime invocation
 * - Output validation
 * - Safe error normalization
 *
 * Test scenarios:
 * 1. allowed workflow caller succeeds - valid callers can successfully invoke
 * 2. denied visibility rejects before runtime - callers without visibility are rejected
 * 3. missing permission returns safe error - callers without permissions get safe error
 * 4. runtime failure normalizes output - runtime errors are properly normalized
 * 5. schema validation gates invocation - invalid input schema prevents invocation
 */

// ============================================================================
// Type Definitions
// ============================================================================

interface PluginCapabilityEndpoint {
  pluginId: string;
  version: string;
  contributionId: string;
  globalEndpointName: string;
  displayName: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiredPermissions: string[];
  operation: string;
  retryable: boolean;
  visibility: string[];
  timeoutMs?: number;
}

interface PluginRuntimeOperationResult {
  ok: boolean;
  output?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

interface RegistryEntry {
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
    displayName: string;
    config: Record<string, unknown>;
  }>;
  scan_result: { status: string };
  compatibility_result: { status: string };
}

interface PolicyDecision {
  allowed: boolean;
  reasonCode?: string;
  message?: string;
}

interface EndpointRegistry {
  findByGlobalEndpointName(name: string): Promise<PluginCapabilityEndpoint | null>;
}

interface RuntimeManager {
  invokePlugin(params: {
    pluginId: string;
    version: string;
    contributionId: string;
    operation: string;
    input: unknown;
    timeoutMs?: number;
    actorId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PluginRuntimeOperationResult>;
}

interface PolicyService {
  decideCapabilityEndpointInvocation(params: {
    context: {
      pluginId: string;
      version: string;
      trustLevel: string;
      isolationMode: string;
      lifecycleState: string;
      enabled: boolean;
      requestedPermissions: Array<{ kind: string; capabilities: string[] }>;
      grantedPermissions: Array<{ kind: string; capabilities: string[] }>;
      contributions: Array<{
        id: string;
        type: string;
        displayName: string;
        config: Record<string, unknown>;
      }>;
      scanStatus: string;
      compatibilityStatus: string;
      runtimeHealth: string;
      supportedContributionOperations: Record<string, string[]>;
    };
    contributionId: string;
    operation: string;
    callerFamily: string;
    visibility: string[];
    requiredPermissions: string[];
  }): PolicyDecision;
}

interface RegistryEntriesRepository {
  findByPluginIdAndVersion(pluginId: string, version: string): Promise<RegistryEntry | null>;
}

interface CapabilityEndpointInvocationResult {
  ok: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

// ============================================================================
// Mock Service Implementation (for TDD - defines expected behavior)
// ============================================================================

/**
 * Mock implementation of the capability endpoint invocation service.
 * This defines the expected behavior contract that the real implementation
 * must follow.
 */
class MockPluginCapabilityEndpointInvocationService {
  constructor(
    private readonly endpointRegistry: EndpointRegistry,
    private readonly runtimeManager: RuntimeManager,
    private readonly policyService: PolicyService,
    private readonly registryEntries: RegistryEntriesRepository,
  ) {}

  async invoke(request: {
    endpointName: string;
    input: unknown;
    callerFamily: string;
    callerId?: string;
    actorId?: string;
  }): Promise<CapabilityEndpointInvocationResult> {
    // Step 1: Look up endpoint
    const endpoint = await this.endpointRegistry.findByGlobalEndpointName(request.endpointName);
    if (!endpoint) {
      return {
        ok: false,
        error: {
          code: 'capability_endpoint_not_found',
          message: 'Plugin capability endpoint was not found.',
          retryable: false,
        },
      };
    }

    // Step 2: Validate input schema (gate invocation)
    if (!this.validateInputSchema(endpoint.inputSchema, request.input)) {
      return {
        ok: false,
        error: {
          code: 'capability_endpoint_input_invalid',
          message: 'Capability endpoint input did not match schema.',
          retryable: false,
        },
      };
    }

    // Step 3: Get registry entry for policy check
    const registryEntry = await this.registryEntries.findByPluginIdAndVersion(
      endpoint.pluginId,
      endpoint.version,
    );
    if (!registryEntry) {
      return {
        ok: false,
        error: {
          code: 'capability_endpoint_not_found',
          message: 'Plugin capability endpoint was not found.',
          retryable: false,
        },
      };
    }

    // Step 4: Policy check (visibility + permissions)
    const policyDecision = this.policyService.decideCapabilityEndpointInvocation({
      context: {
        pluginId: registryEntry.plugin_id,
        version: registryEntry.version,
        trustLevel: registryEntry.trust_level,
        isolationMode: registryEntry.isolation_mode,
        lifecycleState: registryEntry.lifecycle_state,
        enabled: registryEntry.enabled,
        requestedPermissions: registryEntry.requested_permissions,
        grantedPermissions: registryEntry.granted_permissions,
        contributions: registryEntry.contributions,
        scanStatus: registryEntry.scan_result?.status === 'passed' ? 'passed' : 'failed',
        compatibilityStatus: registryEntry.compatibility_result?.status === 'passed' ? 'passed' : 'failed',
        runtimeHealth: 'healthy',
        supportedContributionOperations: {
          [endpoint.contributionId]: [endpoint.operation],
        },
      },
      contributionId: endpoint.contributionId,
      operation: endpoint.operation,
      callerFamily: request.callerFamily,
      visibility: endpoint.visibility,
      requiredPermissions: endpoint.requiredPermissions,
    });

    // Step 5: Deny if policy rejects (rejects before runtime)
    if (!policyDecision.allowed) {
      return {
        ok: false,
        error: {
          code: 'capability_endpoint_denied',
          message: 'Capability endpoint invocation denied by policy.',
          retryable: false,
        },
      };
    }

    // Step 6: Invoke runtime
    const runtimeResult = await this.runtimeManager.invokePlugin({
      pluginId: endpoint.pluginId,
      version: endpoint.version,
      contributionId: endpoint.contributionId,
      operation: endpoint.operation,
      input: request.input,
      timeoutMs: endpoint.timeoutMs,
      actorId: request.actorId ?? 'plugin-capability-endpoint-invocation',
      metadata: {
        callerFamily: request.callerFamily,
        callerId: request.callerId ?? 'unknown',
        endpointName: request.endpointName,
      },
    });

    // Step 7: Handle runtime failure (normalize output)
    if (!runtimeResult.ok) {
      return {
        ok: false,
        error: {
          code: 'capability_endpoint_runtime_failed',
          message: 'Capability endpoint runtime invocation failed.',
          retryable: runtimeResult.error?.retryable ?? true,
        },
      };
    }

    // Step 8: Validate output schema
    if (endpoint.outputSchema && !this.validateInputSchema(endpoint.outputSchema, runtimeResult.output)) {
      return {
        ok: false,
        error: {
          code: 'capability_endpoint_output_invalid',
          message: 'Capability endpoint output did not match schema.',
          retryable: false,
        },
      };
    }

    return { ok: true, output: runtimeResult.output };
  }

  private validateInputSchema(schema: Record<string, unknown>, value: unknown): boolean {
    if (!schema || typeof schema !== 'object') return true;
    if (typeof value !== 'object' || value === null) return false;

    const valueObj = value as Record<string, unknown>;
    const properties = schema['properties'] as Record<string, unknown> | undefined;
    const required = schema['required'] as string[] | undefined;
    const additionalProperties = schema['additionalProperties'];

    // Check required fields
    if (required && Array.isArray(required)) {
      for (const field of required) {
        if (!(field in valueObj)) return false;
      }
    }

    // Check for unexpected fields if additionalProperties is false
    if (additionalProperties === false && properties) {
      const allowedFields = new Set(Object.keys(properties));
      for (const key of Object.keys(valueObj)) {
        if (!allowedFields.has(key)) return false;
      }
    }

    return true;
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Plugin Capability Endpoint Integration', () => {
  // --------------------------------------------------------------------------
  // Test Suite 1: allowed workflow caller succeeds (happy path)
  // --------------------------------------------------------------------------
  describe('allowed workflow caller succeeds', () => {
    it('successfully invokes endpoint when all checks pass', async () => {
      // Arrange: Endpoint that allows 'workflow' callers
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'acme.plugin',
          version: '1.0.0',
          contributionId: 'audit-endpoint',
          globalEndpointName: 'plugin:acme.plugin:audit-endpoint',
          displayName: 'Audit Endpoint',
          inputSchema: {
            type: 'object',
            properties: { runId: { type: 'string' } },
            required: ['runId'],
            additionalProperties: false,
          },
          outputSchema: {
            type: 'object',
            properties: { accepted: { type: 'boolean' } },
            required: ['accepted'],
            additionalProperties: false,
          },
          requiredPermissions: [],
          operation: 'invoke_audit',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: true,
          output: { accepted: true },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'acme.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [
            {
              id: 'audit-endpoint',
              type: 'capability.endpoint',
              displayName: 'Audit Endpoint',
              config: {
                inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
                operation: 'invoke_audit',
                visibility: ['workflow'],
              },
            },
          ],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:acme.plugin:audit-endpoint',
        input: { runId: 'run-1' },
        callerFamily: 'workflow',
        callerId: 'workflow-run-1',
      });

      // Assert
      expect(result).toEqual({ ok: true, output: { accepted: true } });
      expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'acme.plugin',
          contributionId: 'audit-endpoint',
          operation: 'invoke_audit',
        }),
      );
    });

    it('allows internal callers when endpoint visibility includes internal', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'admin.plugin',
          version: '1.0.0',
          contributionId: 'admin-endpoint',
          globalEndpointName: 'plugin:admin.plugin:admin-endpoint',
          displayName: 'Admin Endpoint',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'admin_operation',
          retryable: false,
          visibility: ['internal'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: true,
          output: { success: true },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'admin.plugin',
          version: '1.0.0',
          trust_level: 'system',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:admin.plugin:admin-endpoint',
        input: {},
        callerFamily: 'internal',
      });

      // Assert
      expect(result.ok).toBe(true);
      expect(result.output).toEqual({ success: true });
    });

    it('allows tool callers when endpoint visibility includes tool', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'data.plugin',
          version: '1.0.0',
          contributionId: 'data-endpoint',
          globalEndpointName: 'plugin:data.plugin:data-endpoint',
          displayName: 'Data Endpoint',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'fetch_data',
          retryable: true,
          visibility: ['tool', 'workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: true,
          output: { data: [{ id: '1' }] },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'data.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:data.plugin:data-endpoint',
        input: { query: 'test' },
        callerFamily: 'tool',
      });

      // Assert
      expect(result.ok).toBe(true);
      expect(result.output).toEqual({ data: [{ id: '1' }] });
    });
  });

  // --------------------------------------------------------------------------
  // Test Suite 2: denied visibility rejects before runtime (policy enforcement)
  // --------------------------------------------------------------------------
  describe('denied visibility rejects before runtime', () => {
    it('rejects caller when endpoint visibility does not include caller family', async () => {
      // Arrange: Endpoint that only allows 'tool' callers, but called by 'workflow'
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'secure.plugin',
          version: '2.0.0',
          contributionId: 'secure-endpoint',
          globalEndpointName: 'plugin:secure.plugin:secure-endpoint',
          displayName: 'Secure Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'secure_operation',
          retryable: true,
          visibility: ['tool'], // Only allows 'tool' callers
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn(),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: false,
          reasonCode: 'capability_endpoint_visibility_denied',
          message: 'Capability endpoint is not visible to this caller family.',
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'secure.plugin',
          version: '2.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:secure.plugin:secure-endpoint',
        input: { data: 'test' },
        callerFamily: 'workflow', // Not allowed - should be rejected
      });

      // Assert: Should return safe error, not invoke runtime
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_denied',
          message: 'Capability endpoint invocation denied by policy.',
          retryable: false,
        },
      });
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
      expect(policyService.decideCapabilityEndpointInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          callerFamily: 'workflow',
          visibility: ['tool'],
        }),
      );
    });

    it('rejects when endpoint is not visible to any caller (empty visibility)', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'hidden.plugin',
          version: '1.0.0',
          contributionId: 'hidden-endpoint',
          globalEndpointName: 'plugin:hidden.plugin:hidden-endpoint',
          displayName: 'Hidden Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'hidden_operation',
          retryable: true,
          visibility: [], // No visibility = no access
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: false,
          reasonCode: 'capability_endpoint_visibility_denied',
          message: 'Capability endpoint is not visible to this caller family.',
        } satisfies PolicyDecision),
      };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'hidden.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:hidden.plugin:hidden-endpoint',
        input: {},
        callerFamily: 'internal',
      });

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('capability_endpoint_denied');
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });

    it('rejects workflow caller when only internal visibility is configured', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'internal.plugin',
          version: '1.0.0',
          contributionId: 'internal-endpoint',
          globalEndpointName: 'plugin:internal.plugin:internal-endpoint',
          displayName: 'Internal Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'internal_operation',
          retryable: true,
          visibility: ['internal'], // Only internal callers
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: false,
          reasonCode: 'capability_endpoint_visibility_denied',
        } satisfies PolicyDecision),
      };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'internal.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:internal.plugin:internal-endpoint',
        input: {},
        callerFamily: 'workflow',
      });

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('capability_endpoint_denied');
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Test Suite 3: missing permission returns safe error (error normalization)
  // --------------------------------------------------------------------------
  describe('missing permission returns safe error', () => {
    it('returns safe error when caller lacks required permission', async () => {
      // Arrange: Endpoint that requires 'admin.write' permission
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'admin.plugin',
          version: '1.0.0',
          contributionId: 'admin-endpoint',
          globalEndpointName: 'plugin:admin.plugin:admin-endpoint',
          displayName: 'Admin Endpoint',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          requiredPermissions: ['internal_capability:admin.write'],
          operation: 'admin_operation',
          retryable: true,
          visibility: ['workflow', 'tool'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: false,
          reasonCode: 'capability_endpoint_permission_denied',
          message: 'Required permission internal_capability:admin.write is not granted.',
        } satisfies PolicyDecision),
      };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'admin.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'sandboxed',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [{ kind: 'internal_capability', capabilities: ['admin.write'] }],
          granted_permissions: [], // No permissions granted!
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:admin.plugin:admin-endpoint',
        input: { action: 'delete' },
        callerFamily: 'tool',
      });

      // Assert: Returns safe error, not actual permission details
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_denied',
          message: 'Capability endpoint invocation denied by policy.',
          retryable: false,
        },
      });
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });

    it('allows caller with correct permission to proceed', async () => {
      // Arrange: Endpoint that requires 'plugin.endpoint.invoke' permission
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'api.plugin',
          version: '1.0.0',
          contributionId: 'api-endpoint',
          globalEndpointName: 'plugin:api.plugin:api-endpoint',
          displayName: 'API Endpoint',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          requiredPermissions: ['internal_capability:plugin.endpoint.invoke'],
          operation: 'api_operation',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: true,
          output: { result: 'success' },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'api.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
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
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:api.plugin:api-endpoint',
        input: {},
        callerFamily: 'workflow',
      });

      // Assert: Successfully invokes
      expect(result.ok).toBe(true);
      expect(result.output).toEqual({ result: 'success' });
    });

    it('returns safe error without exposing internal permission details', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'sensitive.plugin',
          version: '1.0.0',
          contributionId: 'sensitive-endpoint',
          globalEndpointName: 'plugin:sensitive.plugin:sensitive-endpoint',
          displayName: 'Sensitive Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: ['secret:access', 'admin:write', 'data:delete'],
          operation: 'sensitive_operation',
          retryable: false,
          visibility: ['internal'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: false,
          reasonCode: 'capability_endpoint_permission_denied',
          message: 'Required permissions not granted.',
        } satisfies PolicyDecision),
      };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'sensitive.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'sandboxed',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [
            { kind: 'secret', capabilities: ['access'] },
            { kind: 'admin', capabilities: ['write'] },
            { kind: 'data', capabilities: ['delete'] },
          ],
          granted_permissions: [{ kind: 'admin', capabilities: ['read'] }], // Only partial
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:sensitive.plugin:sensitive-endpoint',
        input: {},
        callerFamily: 'internal',
      });

      // Assert: Error does not expose which specific permissions are missing
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_denied',
          message: 'Capability endpoint invocation denied by policy.',
          retryable: false,
        },
      });
      expect(result.error?.message).not.toContain('secret');
      expect(result.error?.message).not.toContain('admin');
    });
  });

  // --------------------------------------------------------------------------
  // Test Suite 4: runtime failure normalizes output (error handling)
  // --------------------------------------------------------------------------
  describe('runtime failure normalizes output', () => {
    it('normalizes timeout error from runtime', async () => {
      // Arrange
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'flaky.plugin',
          version: '1.0.0',
          contributionId: 'flaky-endpoint',
          globalEndpointName: 'plugin:flaky.plugin:flaky-endpoint',
          displayName: 'Flaky Endpoint',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'flaky_operation',
          retryable: true,
          visibility: ['internal'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'PLUGIN_TIMEOUT',
            message: 'Plugin execution timed out after 30000ms.',
            retryable: true,
          },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'flaky.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:flaky.plugin:flaky-endpoint',
        input: {},
        callerFamily: 'internal',
      });

      // Assert: Normalized output - original error code not exposed
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_runtime_failed',
          message: 'Capability endpoint runtime invocation failed.',
          retryable: true,
        },
      });
    });

    it('normalizes plugin crash error from runtime', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'crash.plugin',
          version: '1.0.0',
          contributionId: 'crash-endpoint',
          globalEndpointName: 'plugin:crash.plugin:crash-endpoint',
          displayName: 'Crash Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'crash_operation',
          retryable: false,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'PLUGIN_CRASH',
            message: 'Plugin process exited with code 1.',
            retryable: false,
          },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'crash.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:crash.plugin:crash-endpoint',
        input: {},
        callerFamily: 'workflow',
      });

      // Assert: Normalized output
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_runtime_failed',
          message: 'Capability endpoint runtime invocation failed.',
          retryable: false,
        },
      });
    });

    it('preserves retryable flag from runtime error', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'transient.plugin',
          version: '1.0.0',
          contributionId: 'transient-endpoint',
          globalEndpointName: 'plugin:transient.plugin:transient-endpoint',
          displayName: 'Transient Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'transient_operation',
          retryable: true,
          visibility: ['tool'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'PLUGIN_TRANSIENT_ERROR',
            message: 'Temporary network error.',
            retryable: true,
          },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'transient.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:transient.plugin:transient-endpoint',
        input: {},
        callerFamily: 'tool',
      });

      // Assert: retryable flag preserved
      expect(result.ok).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });

    it('normalizes out of memory error', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'memory.plugin',
          version: '1.0.0',
          contributionId: 'memory-endpoint',
          globalEndpointName: 'plugin:memory.plugin:memory-endpoint',
          displayName: 'Memory Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'memory_operation',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'PLUGIN_OOM',
            message: 'Plugin ran out of memory. Limit: 512MB',
            retryable: false,
          },
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'memory.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'sandboxed',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:memory.plugin:memory-endpoint',
        input: { data: 'x'.repeat(1000000) },
        callerFamily: 'workflow',
      });

      // Assert
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_runtime_failed',
          message: 'Capability endpoint runtime invocation failed.',
          retryable: false,
        },
      });
    });
  });

  // --------------------------------------------------------------------------
  // Test Suite 5: schema validation gates invocation (input validation)
  // --------------------------------------------------------------------------
  describe('schema validation gates invocation', () => {
    it('rejects input with missing required field', async () => {
      // Arrange: Endpoint with required field 'runId'
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'acme.plugin',
          version: '1.0.0',
          contributionId: 'audit-endpoint',
          globalEndpointName: 'plugin:acme.plugin:audit-endpoint',
          displayName: 'Audit Endpoint',
          inputSchema: {
            type: 'object',
            properties: { runId: { type: 'string' } },
            required: ['runId'],
            additionalProperties: false,
          },
          requiredPermissions: [],
          operation: 'invoke_audit',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'acme.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act: Send invalid input (missing required field)
      const result = await service.invoke({
        endpointName: 'plugin:acme.plugin:audit-endpoint',
        input: { invalid: true }, // Missing 'runId'
        callerFamily: 'workflow',
      });

      // Assert: Rejected before policy check or runtime invocation
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_input_invalid',
          message: 'Capability endpoint input did not match schema.',
          retryable: false,
        },
      });
      expect(policyService.decideCapabilityEndpointInvocation).not.toHaveBeenCalled();
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });

    it('rejects input with unexpected additional property', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'strict.plugin',
          version: '1.0.0',
          contributionId: 'strict-endpoint',
          globalEndpointName: 'plugin:strict.plugin:strict-endpoint',
          displayName: 'Strict Endpoint',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false, // No extra properties allowed
          },
          requiredPermissions: [],
          operation: 'strict_operation',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'strict.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act: Send input with extra property
      const result = await service.invoke({
        endpointName: 'plugin:strict.plugin:strict-endpoint',
        input: { name: 'valid', extraField: 'not allowed' },
        callerFamily: 'workflow',
      });

      // Assert: Rejected due to additional property
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_input_invalid',
          message: 'Capability endpoint input did not match schema.',
          retryable: false,
        },
      });
      expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    });

    it('accepts valid input that matches schema', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'acme.plugin',
          version: '1.0.0',
          contributionId: 'audit-endpoint',
          globalEndpointName: 'plugin:acme.plugin:audit-endpoint',
          displayName: 'Audit Endpoint',
          inputSchema: {
            type: 'object',
            properties: {
              runId: { type: 'string' },
              level: { type: 'string', enum: ['info', 'warn', 'error'] },
            },
            required: ['runId'],
            additionalProperties: false,
          },
          requiredPermissions: [],
          operation: 'invoke_audit',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: true,
          output: { accepted: true },
        } satisfies PluginRuntimeOperationResult),
      };
      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'acme.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act: Send valid input
      const result = await service.invoke({
        endpointName: 'plugin:acme.plugin:audit-endpoint',
        input: { runId: 'run-123', level: 'info' },
        callerFamily: 'workflow',
      });

      // Assert: Accepted and processed
      expect(result.ok).toBe(true);
      expect(result.output).toEqual({ accepted: true });
      expect(runtimeManager.invokePlugin).toHaveBeenCalled();
    });

    it('returns not found error when endpoint does not exist', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue(null), // Endpoint not found
      };
      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = { decideCapabilityEndpointInvocation: vi.fn() };
      const registryEntries = { findByPluginIdAndVersion: vi.fn() };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:nonexistent.plugin:nonexistent-endpoint',
        input: {},
        callerFamily: 'workflow',
      });

      // Assert
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_not_found',
          message: 'Plugin capability endpoint was not found.',
          retryable: false,
        },
      });
    });

    it('returns not found error when plugin registry entry does not exist', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'orphan.plugin',
          version: '1.0.0',
          contributionId: 'orphan-endpoint',
          globalEndpointName: 'plugin:orphan.plugin:orphan-endpoint',
          displayName: 'Orphan Endpoint',
          inputSchema: { type: 'object' },
          requiredPermissions: [],
          operation: 'orphan_operation',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };
      const runtimeManager = { invokePlugin: vi.fn() };
      const policyService = { decideCapabilityEndpointInvocation: vi.fn() };
      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue(null), // Registry entry not found
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:orphan.plugin:orphan-endpoint',
        input: {},
        callerFamily: 'workflow',
      });

      // Assert
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_not_found',
          message: 'Plugin capability endpoint was not found.',
          retryable: false,
        },
      });
    });

    it('validates output schema and returns error if output does not match', async () => {
      const endpointRegistry = {
        findByGlobalEndpointName: vi.fn().mockResolvedValue({
          pluginId: 'strict.plugin',
          version: '1.0.0',
          contributionId: 'strict-endpoint',
          globalEndpointName: 'plugin:strict.plugin:strict-endpoint',
          displayName: 'Strict Endpoint',
          inputSchema: { type: 'object' },
          outputSchema: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
            additionalProperties: false,
          },
          requiredPermissions: [],
          operation: 'strict_operation',
          retryable: true,
          visibility: ['workflow'],
        } satisfies PluginCapabilityEndpoint),
      };

      const runtimeManager = {
        invokePlugin: vi.fn().mockResolvedValue({
          ok: true,
          output: { status: 'ok', extraField: 'not allowed' }, // Output has extra field
        } satisfies PluginRuntimeOperationResult),
      };

      const policyService = {
        decideCapabilityEndpointInvocation: vi.fn().mockReturnValue({
          allowed: true,
        } satisfies PolicyDecision),
      };

      const registryEntries = {
        findByPluginIdAndVersion: vi.fn().mockResolvedValue({
          plugin_id: 'strict.plugin',
          version: '1.0.0',
          trust_level: 'local_trusted',
          isolation_mode: 'worker_process',
          lifecycle_state: 'enabled',
          enabled: true,
          requested_permissions: [],
          granted_permissions: [],
          contributions: [],
          scan_result: { status: 'passed' },
          compatibility_result: { status: 'passed' },
        } satisfies RegistryEntry),
      };

      const service = new MockPluginCapabilityEndpointInvocationService(
        endpointRegistry as EndpointRegistry,
        runtimeManager as RuntimeManager,
        policyService as PolicyService,
        registryEntries as RegistryEntriesRepository,
      );

      // Act
      const result = await service.invoke({
        endpointName: 'plugin:strict.plugin:strict-endpoint',
        input: {},
        callerFamily: 'workflow',
      });

      // Assert
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'capability_endpoint_output_invalid',
          message: 'Capability endpoint output did not match schema.',
          retryable: false,
        },
      });
    });
  });
});
