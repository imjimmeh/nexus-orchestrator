/**
 * Shared tool naming utilities for building tool prefixes, registry names, and invoke paths.
 * Provides generic naming functions for MCP and ACP plugins.
 */

import { createHash } from 'node:crypto';

const TOOL_NAME_MAX_LENGTH = 64;

/**
 * Generates a hash fragment of specified length from a string value.
 */
export function hashFragment(value: string, length: number): string {
  return createHash('sha1').update(value).digest('hex').slice(0, length);
}

/**
 * Builds a server namespace hash for use in tool naming.
 * Returns a 12-character hash of the server ID.
 */
export function buildServerNamespace(serverId: string): string {
  return hashFragment(serverId, 12);
}

/**
 * Sanitizes a tool name token by converting to lowercase, replacing non-alphanumeric
 * characters with underscores, and trimming underscores from ends.
 * Returns 'tool' if the sanitized result would be empty.
 */
export function sanitizeToolToken(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (sanitized.length === 0) {
    return 'tool';
  }

  return sanitized.slice(0, TOOL_NAME_MAX_LENGTH);
}

/**
 * Sanitizes an agent name token. Same logic as sanitizeToolToken but with
 * 'agent' as the fallback name.
 */
export function sanitizeAgentToken(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (sanitized.length === 0) {
    return 'agent';
  }

  return sanitized.slice(0, TOOL_NAME_MAX_LENGTH);
}

/**
 * Builds a tool prefix for a given namespace and server ID.
 * Format: {namespace}_{serverNamespace}_
 */
export function buildToolPrefix(
  namespace: string,
  serverNamespace: string,
): string {
  return `${namespace}_${serverNamespace}_`;
}

/**
 * Builds a registry tool name using prefix, sanitized name, and hash.
 * Format: {prefix}{safeName}_{hash}
 */
export function buildRegistryToolName(
  prefix: string,
  name: string,
  hashFn: (value: string, length: number) => string = hashFragment,
): string {
  const safeName = sanitizeToolToken(name);
  const nameHash = hashFn(name, 8);
  return `${prefix}${safeName}_${nameHash}`;
}

/**
 * Builds an invoke path for MCP tools.
 * Format: /api/mcp/servers/{serverId}/tools/{toolName}/invoke
 */
export function buildMcpInvokePath(serverId: string, toolName: string): string {
  return `/api/mcp/servers/${serverId}/tools/${encodeURIComponent(toolName)}/invoke`;
}

/**
 * Builds an invoke path for ACP agents.
 * Format: /api/acp/servers/{serverId}/agents/{agentName}/invoke
 */
export function buildAcpInvokePath(
  serverId: string,
  agentName: string,
): string {
  return `/api/acp/servers/${serverId}/agents/${encodeURIComponent(agentName)}/invoke`;
}
