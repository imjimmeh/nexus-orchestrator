import {
  CloseWarRoomSchema,
  GetWarRoomStateSchema,
  InviteWarRoomParticipantSchema,
  OpenWarRoomSchema,
  PostWarRoomMessageSchema,
  SubmitWarRoomSignoffSchema,
  UpdateWarRoomBlackboardSchema,
} from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

const OpenWarRoomInputSchema = OpenWarRoomSchema.omit({ action: true });
const InviteWarRoomParticipantInputSchema = InviteWarRoomParticipantSchema.omit(
  { action: true },
);
const PostWarRoomMessageInputSchema = PostWarRoomMessageSchema.omit({
  action: true,
});
const UpdateWarRoomBlackboardInputSchema = UpdateWarRoomBlackboardSchema.omit({
  action: true,
});
const SubmitWarRoomSignoffInputSchema = SubmitWarRoomSignoffSchema.omit({
  action: true,
});
const GetWarRoomStateInputSchema = GetWarRoomStateSchema.omit({ action: true });
const CloseWarRoomInputSchema = CloseWarRoomSchema.omit({ action: true });

export class WarRoomCapabilityProvider {
  @Capability({
    name: 'open_war_room',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Open a workflow-scoped war-room session.',
    inputSchema: OpenWarRoomInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/war-room/open',
      bodyMapping: {
        session_id: 'session_id',
        scope_id: 'scope_id',
        context_id: 'context_id',
        participants: 'participants',
        initial_message: 'initial_message',
      },
    },
  })
  openWarRoom() {
    return { ok: true };
  }

  @Capability({
    name: 'invite_war_room_participant',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Invite an agent profile to an existing war-room session.',
    inputSchema: InviteWarRoomParticipantInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/war-room/invite-participant',
      bodyMapping: {
        session_id: 'session_id',
        agent_profile: 'agent_profile',
        target_agent_profile: 'target_agent_profile',
        role: 'role',
      },
    },
  })
  inviteWarRoomParticipant() {
    return { ok: true };
  }

  @Capability({
    name: 'post_war_room_message',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Post a message to a workflow war-room session.',
    inputSchema: PostWarRoomMessageInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/war-room/post-message',
      bodyMapping: {
        session_id: 'session_id',
        message_kind: 'message_kind',
        body: 'body',
      },
    },
  })
  postWarRoomMessage() {
    return { ok: true };
  }

  @Capability({
    name: 'update_war_room_blackboard',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Append a new blackboard version to a war-room session.',
    inputSchema: UpdateWarRoomBlackboardInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/war-room/update-blackboard',
      bodyMapping: {
        session_id: 'session_id',
        expected_version: 'expected_version',
        strategy_summary: 'strategy_summary',
        risks: 'risks',
        decision_log: 'decision_log',
        implementation_plan_ref: 'implementation_plan_ref',
      },
    },
  })
  updateWarRoomBlackboard() {
    return { ok: true };
  }

  @Capability({
    name: 'submit_war_room_signoff',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Submit this agent profile signoff for a war-room role.',
    inputSchema: SubmitWarRoomSignoffInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/war-room/submit-signoff',
      bodyMapping: {
        session_id: 'session_id',
        role: 'role',
        agent_profile: 'agent_profile',
        decision: 'decision',
        rationale: 'rationale',
      },
    },
  })
  submitWarRoomSignoff() {
    return { ok: true };
  }

  @Capability({
    name: 'get_war_room_state',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'state'],
    description: 'Read the current state of a workflow war-room session.',
    inputSchema: GetWarRoomStateInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/war-room/state',
      bodyMapping: {
        session_id: 'session_id',
      },
    },
  })
  getWarRoomState() {
    return { ok: true };
  }

  @Capability({
    name: 'close_war_room',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Close a workflow war-room session with a resolution.',
    inputSchema: CloseWarRoomInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/war-room/close',
      bodyMapping: {
        session_id: 'session_id',
        resolution_type: 'resolution_type',
        resolution_note: 'resolution_note',
      },
    },
  })
  closeWarRoom() {
    return { ok: true };
  }
}
