import { z } from "zod";
import {
  MentionAgentSchema,
  CheckAgentMentionsSchema,
  ResolveAgentThreadSchema,
  InviteAgentToChatSchema,
} from "./agent-mentions.schemas";

export type MentionAgentInput = z.infer<typeof MentionAgentSchema>;
export type CheckAgentMentionsInput = z.infer<typeof CheckAgentMentionsSchema>;
export type ResolveAgentThreadInput = z.infer<typeof ResolveAgentThreadSchema>;
export type InviteAgentToChatInput = z.infer<typeof InviteAgentToChatSchema>;
