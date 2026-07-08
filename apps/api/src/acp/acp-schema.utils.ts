import type { AcpServer } from './database/entities/acp-server.entity';
import type { AcpAgentManifest } from '@nexus/core';
import {
  buildRegistrySchema,
  buildAcpNexusExtension,
  normalizeAcpInputSchema,
} from '../common/plugin-runtime/plugin-schema.utils';

/**
 * Builds an ACP registry schema for an agent manifest.
 *
 * @param params.server - The ACP server record
 * @param params.manifest - The agent manifest
 * @param params.registryToolName - The full registry tool name
 * @returns A schema object with x-nexus-acp extension
 */
export function buildAcpRegistrySchema(params: {
  server: AcpServer;
  manifest: AcpAgentManifest;
  registryToolName: string;
}): Record<string, unknown> {
  const schema = normalizeAcpInputSchema(params.manifest.input_content_types);

  const nexusExtension = buildAcpNexusExtension({
    serverId: params.server.id,
    serverName: params.server.name,
    agentName: params.manifest.name,
    registryToolName: params.registryToolName,
  });

  return buildRegistrySchema({
    schema,
    description: params.manifest.description ?? null,
    nexusExtension,
  });
}
