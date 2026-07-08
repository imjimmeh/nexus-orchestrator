import { Injectable } from '@nestjs/common';
import { requireJwtSecret } from '../config/jwt-runtime-config';
import { signAgentToken } from '../auth/sign-agent-token';
import type { AgentTokenPayload } from './agent-token.service.types';

export type { AgentTokenPayload } from './agent-token.service.types';

@Injectable()
export class AgentTokenService {
  mintAgentToken(payload: AgentTokenPayload): string {
    return signAgentToken(
      {
        sub: `agent:chat:${payload.chatSessionId}`,
        role: 'agent',
        roles: ['Agent'],
        stepId: payload.chatSessionId,
        chatSessionId: payload.chatSessionId,
        agentProfileName: payload.agentProfileName,
        ...(payload.contextId && { scopeId: payload.contextId }),
      },
      requireJwtSecret(),
    );
  }
}
