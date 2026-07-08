/**
 * Shared schema utilities for building registry schemas for MCP and ACP plugins.
 * Provides generic schema building functions for tool/agent registration.
 */

import type { BuildRegistrySchemaParams } from './plugin-schema.types';

/**
 * Generic function to build a registry schema.
 * Combines normalized schema, description, and nexus extension into a single schema object.
 */
export function buildRegistrySchema<
  TNormalizedSchema extends Record<string, unknown>,
>(params: BuildRegistrySchemaParams<TNormalizedSchema>): TNormalizedSchema {
  const { schema, description, nexusExtension } = params;

  // Apply description if provided and not already set
  applyDescriptionToSchema(schema, description ?? null);

  const namespace = nexusExtension.namespace;
  const extensionKey =
    typeof namespace === 'string' && namespace.length > 0
      ? `x-nexus-${namespace}`
      : 'x-nexus-unknown';
  const registrySchema: Record<string, unknown> = schema;
  registrySchema[extensionKey] = nexusExtension;

  return schema;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/**
 * Normalizes an input schema to ensure it has required properties.
 * Used by MCP schema building.
 */
export function normalizeMcpInputSchema(
  inputSchema: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!inputSchema) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    };
  }

  const schema = cloneRecord(inputSchema);

  if (schema.type === undefined) {
    schema.type = 'object';
  }

  if (schema.properties === undefined) {
    schema.properties = {};
  }

  if (schema.additionalProperties === undefined) {
    schema.additionalProperties = true;
  }

  return schema;
}

/**
 * Normalizes input content types for ACP schema building.
 */
export function normalizeAcpInputSchema(
  inputContentTypes?: string[] | null,
): Record<string, unknown> {
  if (!inputContentTypes || inputContentTypes.length === 0) {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  return {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: `ACP agent accepts: ${inputContentTypes.join(', ')}`,
      },
    },
    additionalProperties: true,
  };
}

/**
 * Adds description to schema if available and not already set.
 */
export function applyDescriptionToSchema(
  schema: Record<string, unknown>,
  description: string | null | undefined,
): void {
  if (
    typeof description === 'string' &&
    description.length > 0 &&
    typeof schema.description !== 'string'
  ) {
    schema.description = description;
  }
}

/**
 * Builds MCP-specific x-nexus extension for registry schema.
 */
export function buildMcpNexusExtension(params: {
  serverId: string;
  serverName: string;
  transportType: string;
  remoteToolName: string;
  registryToolName: string;
}): Record<string, unknown> {
  return {
    namespace: 'mcp',
    server_id: params.serverId,
    server_name: params.serverName,
    transport_type: params.transportType,
    remote_tool_name: params.remoteToolName,
    registry_tool_name: params.registryToolName,
  };
}

/**
 * Builds ACP-specific x-nexus extension for registry schema.
 */
export function buildAcpNexusExtension(params: {
  serverId: string;
  serverName: string;
  agentName: string;
  registryToolName: string;
}): Record<string, unknown> {
  return {
    namespace: 'acp',
    server_id: params.serverId,
    server_name: params.serverName,
    agent_name: params.agentName,
    registry_tool_name: params.registryToolName,
  };
}
