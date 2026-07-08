import {
  buildServerNamespace,
  buildToolPrefix,
  buildRegistryToolName,
  hashFragment,
  buildMcpInvokePath as buildInvokePathFromShared,
} from '../common/plugin-runtime/plugin-tool-name.utils';

export function buildMcpServerNamespace(serverId: string): string {
  return buildServerNamespace(serverId);
}

export function buildMcpToolPrefix(serverId: string): string {
  const namespace = buildMcpServerNamespace(serverId);
  return buildToolPrefix('mcp', namespace);
}

export function buildMcpRegistryToolName(
  serverId: string,
  remoteToolName: string,
): string {
  const prefix = buildMcpToolPrefix(serverId);
  return buildRegistryToolName(prefix, remoteToolName, hashFragment);
}

export function buildMcpInvokePath(
  serverId: string,
  remoteToolName: string,
): string {
  return buildInvokePathFromShared(serverId, remoteToolName);
}
