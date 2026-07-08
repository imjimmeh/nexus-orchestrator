import {
  buildServerNamespace,
  buildToolPrefix,
  sanitizeAgentToken,
  hashFragment,
  buildAcpInvokePath as buildInvokePathFromShared,
} from '../common/plugin-runtime/plugin-tool-name.utils';

export function buildAcpServerNamespace(serverId: string): string {
  return buildServerNamespace(serverId);
}

export function buildAcpToolPrefix(serverId: string): string {
  const namespace = buildAcpServerNamespace(serverId);
  return buildToolPrefix('acp', namespace);
}

export function buildAcpRegistryToolName(
  serverId: string,
  agentName: string,
): string {
  const prefix = buildAcpToolPrefix(serverId);
  const safeName = sanitizeAgentToken(agentName);
  const nameHash = hashFragment(agentName, 8);
  return `${prefix}${safeName}_${nameHash}`;
}

export function buildAcpInvokePath(
  serverId: string,
  agentName: string,
): string {
  return buildInvokePathFromShared(serverId, agentName);
}
