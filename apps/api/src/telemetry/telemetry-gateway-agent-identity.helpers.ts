import type { AuthenticatedSocket, GatewayEventPayload } from './types';

/**
 * Looks for the agent name baked into a payload by the runner. The runner
 * may emit it under any of a handful of legacy keys; we fall through each
 * candidate in order and return the first non-empty trimmed value.
 */
export function getPayloadAgentName(
  payload: GatewayEventPayload,
): string | undefined {
  const candidateKeys = [
    'agentName',
    'agentProfileName',
    'agent_profile',
    'agentProfile',
    'sender_profile',
  ] as const;

  for (const key of candidateKeys) {
    const value = payload[key];
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

/**
 * Backfills the agent identity fields on a payload when the runner did not
 * stamp them explicitly. When the socket is bound to an agent profile, we
 * forward that name into all three legacy keys (`agentName`,
 * `agentProfileName`, `agent_profile`) so downstream consumers see a uniform
 * identity regardless of which key they prefer.
 */
export function enrichAgentIdentityPayload(
  client: AuthenticatedSocket,
  payload: GatewayEventPayload,
): GatewayEventPayload {
  if (getPayloadAgentName(payload)) {
    return payload;
  }

  if (typeof client.agentProfileName !== 'string') {
    return payload;
  }

  const agentProfileName = client.agentProfileName.trim();
  if (agentProfileName.length === 0) {
    return payload;
  }

  return {
    ...payload,
    agentName: agentProfileName,
    agentProfileName: agentProfileName,
    agent_profile: agentProfileName,
  };
}
