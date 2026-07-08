import { Injectable } from '@nestjs/common';
import Ajv from 'ajv';
import type {
  PluginManifestContribution,
  PluginPermission,
  PluginRuntimeJsonValue,
} from '@nexus/plugin-sdk';
import { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import { PluginPolicyService } from '../plugin-policy.service';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import { PluginCapabilityEndpointRegistryService } from './plugin-capability-endpoint-registry.service';

interface PluginCapabilityEndpointInvokeRequest {
  endpointName: string;
  input: unknown;
  callerFamily: 'workflow' | 'tool' | 'internal' | 'plugin';
  callerId?: string;
  actorId?: string;
}

type PluginCapabilityEndpointInvokeErrorCode =
  | 'capability_endpoint_not_found'
  | 'capability_endpoint_input_invalid'
  | 'capability_endpoint_output_invalid'
  | 'capability_endpoint_denied'
  | 'capability_endpoint_runtime_failed';

type PluginCapabilityEndpointInvokeResult =
  | { ok: true; output?: PluginRuntimeJsonValue }
  | {
      ok: false;
      error: {
        code: PluginCapabilityEndpointInvokeErrorCode;
        message: string;
        retryable: boolean;
      };
    };

@Injectable()
export class PluginCapabilityEndpointInvocationService {
  private readonly ajv = new Ajv({ validateSchema: false });

  constructor(
    private readonly endpointRegistry: PluginCapabilityEndpointRegistryService,
    private readonly runtimeManager: PluginRuntimeManagerService,
    private readonly policyService: PluginPolicyService,
    private readonly registryEntries: PluginRegistryEntryRepository,
  ) {}

  async invoke(
    request: PluginCapabilityEndpointInvokeRequest,
  ): Promise<PluginCapabilityEndpointInvokeResult> {
    const endpoint = await this.endpointRegistry.findByGlobalEndpointName(
      request.endpointName,
    );
    if (!endpoint) {
      return this.error(
        'capability_endpoint_not_found',
        'Plugin capability endpoint was not found.',
        false,
      );
    }

    if (!this.validateSchema(endpoint.inputSchema, request.input)) {
      return this.error(
        'capability_endpoint_input_invalid',
        'Capability endpoint input did not match schema.',
        false,
      );
    }

    const registryEntry = await this.registryEntries.findByPluginIdAndVersion(
      endpoint.pluginId,
      endpoint.version,
    );
    if (!registryEntry) {
      return this.error(
        'capability_endpoint_not_found',
        'Plugin capability endpoint was not found.',
        false,
      );
    }

    const policyDecision =
      this.policyService.decideCapabilityEndpointInvocation({
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
          contributions: this.toPluginContributions(
            registryEntry.contributions,
          ),
          scanStatus:
            registryEntry.scan_result?.status === 'passed'
              ? 'passed'
              : 'failed',
          compatibilityStatus:
            registryEntry.compatibility_result?.status === 'passed'
              ? 'passed'
              : 'failed',
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

    if (!policyDecision.allowed) {
      return this.error(
        'capability_endpoint_denied',
        'Capability endpoint invocation denied by policy.',
        false,
      );
    }

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

    if (!runtimeResult.ok) {
      return this.error(
        'capability_endpoint_runtime_failed',
        'Capability endpoint runtime invocation failed.',
        runtimeResult.error.retryable,
      );
    }

    if (
      endpoint.outputSchema &&
      !this.validateSchema(endpoint.outputSchema, runtimeResult.output)
    ) {
      return this.error(
        'capability_endpoint_output_invalid',
        'Capability endpoint output did not match schema.',
        false,
      );
    }

    return {
      ok: true,
      output: runtimeResult.output,
    };
  }

  private validateSchema(schema: object, value: unknown): boolean {
    try {
      const validate = this.ajv.compile(schema);
      const result = validate(value);
      return typeof result === 'boolean' ? result : false;
    } catch {
      return false;
    }
  }

  private error(
    code: PluginCapabilityEndpointInvokeErrorCode,
    message: string,
    retryable: boolean,
  ): PluginCapabilityEndpointInvokeResult {
    return {
      ok: false,
      error: {
        code,
        message,
        retryable,
      },
    };
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
}
