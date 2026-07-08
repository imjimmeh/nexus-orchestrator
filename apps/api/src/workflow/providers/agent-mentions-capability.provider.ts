import {
  CheckAgentMentionsSchema,
  InviteAgentToChatSchema,
  MentionAgentSchema,
  ResolveAgentThreadSchema,
} from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

const MentionAgentInputSchema = MentionAgentSchema.omit({ action: true });
const CheckAgentMentionsInputSchema = CheckAgentMentionsSchema.omit({
  action: true,
});
const ResolveAgentThreadInputSchema = ResolveAgentThreadSchema.omit({
  action: true,
});
const InviteAgentToChatInputSchema = InviteAgentToChatSchema.omit({
  action: true,
}).extend({
  chat_session_id: MentionAgentSchema.shape.context_id.optional(),
});

export class AgentMentionsCapabilityProvider {
  @Capability({
    name: 'mention_agent',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description:
      'Mention another agent profile within the current workflow run.',
    inputSchema: MentionAgentInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/agent-mentions/mention',
      bodyMapping: {
        target_agent_profile: 'target_agent_profile',
        message: 'message',
        context_id: 'context_id',
        context_files: 'context_files',
        urgency: 'urgency',
        thread_id: 'thread_id',
        correlation_id: 'correlation_id',
      },
    },
  })
  mentionAgent() {
    return { ok: true };
  }

  @Capability({
    name: 'check_agent_mentions',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'state'],
    description: 'Read mention threads for the current agent execution.',
    inputSchema: CheckAgentMentionsInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/agent-mentions/check',
      bodyMapping: {
        thread_id: 'thread_id',
      },
    },
  })
  checkAgentMentions() {
    return { ok: true };
  }

  @Capability({
    name: 'resolve_agent_thread',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Resolve a mention thread for the current workflow run.',
    inputSchema: ResolveAgentThreadInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/agent-mentions/resolve',
      bodyMapping: {
        thread_id: 'thread_id',
        resolution_note: 'resolution_note',
      },
    },
  })
  resolveAgentThread() {
    return { ok: true };
  }

  @Capability({
    name: 'invite_agent_to_chat',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Invite another agent profile to the current chat session.',
    inputSchema: InviteAgentToChatInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/agent-mentions/invite-to-chat',
      bodyMapping: {
        target_agent_profile: 'target_agent_profile',
        reason: 'reason',
        chat_role: 'chat_role',
        chat_session_id: 'chat_session_id',
      },
    },
  })
  inviteAgentToChat() {
    return { ok: true };
  }
}
