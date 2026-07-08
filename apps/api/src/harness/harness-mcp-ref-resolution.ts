import type { ResolvedMcpServerDescriptor } from '@nexus/core';
import { McpTransportType } from '@nexus/core';
import type { McpServer } from '../mcp/database/entities/mcp-server.entity';
import type {
  McpServerRefRepository,
  McpSecretResolver,
  McpRefResolutionResult,
} from './harness-mcp-ref-resolution.types';

export type {
  McpServerRefRepository,
  McpSecretResolver,
  McpRefResolutionResult,
} from './harness-mcp-ref-resolution.types';

/**
 * Resolve a list of MCP server IDs (from `HarnessPlugin.capabilities.mcpServerRefs`)
 * into {@link ResolvedMcpServerDescriptor} objects by querying the `mcp_servers`
 * table.
 *
 * - Disabled servers (`enabled === false`) are silently skipped — no descriptor
 *   is produced, consistent with how the runtime manager treats disabled entries.
 * - Unknown IDs are silently collected into `droppedIds` — never a hard throw.
 * - Duplicate IDs are de-duplicated; each server is queried at most once.
 * - `null` optional fields on the entity are omitted from the descriptor
 *   (consumers see `undefined`, not `null`).
 * - Secret IDs are resolved API-side via `secretResolver`; the resulting `env`/
 *   `headers` maps carry the fully-merged values. Secret values are NEVER logged.
 */
export async function resolveMcpServerRefs(
  ids: string[],
  repo: McpServerRefRepository,
  secretResolver: McpSecretResolver,
): Promise<McpRefResolutionResult> {
  const resolved: ResolvedMcpServerDescriptor[] = [];
  const droppedIds: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);

    const server = await repo.findById(id);
    if (!server) {
      droppedIds.push(id);
      continue;
    }

    // Fix C: skip disabled servers — no descriptor emitted, no diagnostic.
    if (!server.enabled) continue;

    resolved.push(await toDescriptor(server, secretResolver));
  }

  return { resolved, droppedIds };
}

/**
 * Map a {@link McpServer} entity to a {@link ResolvedMcpServerDescriptor}.
 *
 * Only fields relevant to the engine-side MCP bridge are included; internal
 * bookkeeping fields (`last_status`, `last_error`, timestamps, etc.) are
 * intentionally excluded.
 *
 * Secret-bearing fields are resolved here: the `env`/`headers` maps on the
 * descriptor contain fully-merged values (plaintext + secret, secret wins on
 * key collision). NEVER log `env` or `headers` — they may contain credentials.
 */
async function toDescriptor(
  server: McpServer,
  secretResolver: McpSecretResolver,
): Promise<ResolvedMcpServerDescriptor> {
  const isStdio = server.transport_type === McpTransportType.STDIO;
  const descriptor: ResolvedMcpServerDescriptor = {
    id: server.id,
    name: server.name,
    transportType: server.transport_type,
    timeoutMs: server.timeout_ms,
    connectTimeoutMs: server.connect_timeout_ms,
  };

  if (isStdio) {
    if (server.command != null) descriptor.command = server.command;
    if (server.args != null) descriptor.args = server.args;

    // Resolve env: merge plaintext then overlay secret values (secret wins).
    const resolvedEnv = await secretResolver.resolveMap({
      secretId: server.env_secret_id,
      plaintext: server.env,
      purpose: 'env',
      serverName: server.name,
    });
    if (resolvedEnv != null) descriptor.env = resolvedEnv;
  } else {
    // HTTP transport
    if (server.url != null) descriptor.url = server.url;

    // Resolve headers: merge plaintext then overlay secret values (secret wins).
    const resolvedHeaders = await secretResolver.resolveMap({
      secretId: server.headers_secret_id,
      plaintext: server.headers,
      purpose: 'headers',
      serverName: server.name,
    });
    if (resolvedHeaders != null) descriptor.headers = resolvedHeaders;
  }

  if (server.include_tools != null)
    descriptor.includeTools = server.include_tools;
  if (server.exclude_tools != null)
    descriptor.excludeTools = server.exclude_tools;

  return descriptor;
}
