import { z } from "zod";
import {
  NexusMentionUrgencySchema,
  NexusChatParticipantRoleSchema,
} from "./constants.js";

export const MentionAgentSchema = z
  .object({
    action: z.literal("mention_agent"),
    target_agent_profile: z.string().trim().min(1),
    message: z.string().trim().min(1),
    context_id: z.string().trim().min(1).optional(),
    context_files: z.array(z.string().trim().min(1)).optional(),
    urgency: NexusMentionUrgencySchema.optional(),
    thread_id: z.string().trim().min(1).optional(),
    correlation_id: z.string().trim().min(1).optional(),
  })
  .strict();

export const CheckAgentMentionsSchema = z
  .object({
    action: z.literal("check_agent_mentions"),
    thread_id: z.string().trim().min(1).optional(),
  })
  .strict();

export const ResolveAgentThreadSchema = z
  .object({
    action: z.literal("resolve_agent_thread"),
    thread_id: z.string().trim().min(1),
    resolution_note: z.string().trim().min(1).optional(),
  })
  .strict();

export const InviteAgentToChatSchema = z
  .object({
    action: z.literal("invite_agent_to_chat"),
    target_agent_profile: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    chat_role: NexusChatParticipantRoleSchema.optional(),
  })
  .strict();

export * from "./agent-mentions.types";
