import type { ResolvedMcpServerDescriptor } from '@nexus/core';
import type { McpServer } from '../mcp/database/entities/mcp-server.entity';

/**
 * Minimal repository contract required by {@link resolveMcpServerRefs}.
 *
 * Kept narrow so callers can pass a real `McpServerRepository` or a test stub
 * without pulling in TypeORM.
 */
export interface McpServerRefRepository {
  findById(id: string): Promise<McpServer | null>;
}

/**
 * Minimal secret-resolution contract required by {@link resolveMcpServerRefs}.
 *
 * Kept narrow (only `resolveMap`) so callers can inject the real
 * {@link SecretReferenceResolver} or a fake in tests without pulling in
 * NestJS / the crypto stack.
 *
 * Returns `null` when both `secretId` and `plaintext` are absent/null.
 * Never logs the resolved values.
 */
export interface McpSecretResolver {
  resolveMap(options: {
    secretId?: string | null;
    plaintext?: Record<string, string> | null;
    purpose: 'env' | 'headers';
    serverName: string;
  }): Promise<Record<string, string> | null>;
}

/**
 * Result of resolving a list of MCP server IDs against the `mcp_servers` table.
 *
 * Unknown IDs are collected in `droppedIds` so callers can emit diagnostics;
 * this function itself never throws for missing rows.
 */
export interface McpRefResolutionResult {
  resolved: ResolvedMcpServerDescriptor[];
  /** IDs that could not be resolved (server row not found). */
  droppedIds: string[];
}
