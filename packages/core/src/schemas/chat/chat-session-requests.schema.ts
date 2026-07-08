import { z } from "zod";
import { ChatSessionType } from "../../interfaces";

export const CHAT_SESSION_PARTICIPANT_ROLE_VALUES = [
  "owner",
  "participant",
  "moderator",
] as const;

const CHAT_SESSION_TYPE_VALUES = Object.values(ChatSessionType);

export const createChatSessionParticipantSchema = z.object({
  agent_profile: z.string().min(1),
  role: z.enum(CHAT_SESSION_PARTICIPANT_ROLE_VALUES).optional(),
});

export const createChatSessionSchema = z.object({
  agentProfileName: z.string().min(1).max(255),
  scopeId: z.uuid().optional(),
  initialMessage: z.string().min(1).max(4000),
  sessionType: z
    .enum(CHAT_SESSION_TYPE_VALUES as [ChatSessionType, ...ChatSessionType[]])
    .optional(),
  displayName: z.string().min(1).max(512).optional(),
  participants: z.array(createChatSessionParticipantSchema).max(8).optional(),
  moderatorProfile: z.string().min(1).optional(),
});

export const inviteChatSessionParticipantSchema = z.object({
  agent_profile: z.string().min(1),
  role: z.enum(CHAT_SESSION_PARTICIPANT_ROLE_VALUES).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function toBoundedInt(
  value: unknown,
  options: { defaultValue: number; min: number; max: number },
): number {
  const fallback = options.defaultValue;

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(options.max, Math.max(options.min, Math.trunc(value)));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(options.max, Math.max(options.min, parsed));
    }
  }

  return fallback;
}

export const listChatSessionsQuerySchema = z.object({
  scopeId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  limit: z
    .preprocess(
      (value) => toBoundedInt(value, { defaultValue: 50, min: 1, max: 100 }),
      z.number().int().min(1).max(100),
    )
    .optional()
    .default(50),
  offset: z
    .preprocess(
      (value) =>
        toBoundedInt(value, {
          defaultValue: 0,
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        }),
      z.number().int().min(0),
    )
    .optional()
    .default(0),
});

export type CreateChatSessionParticipantRequest = z.infer<
  typeof createChatSessionParticipantSchema
>;

export type CreateChatSessionRequest = z.infer<typeof createChatSessionSchema>;

export type InviteChatSessionParticipantRequest = z.infer<
  typeof inviteChatSessionParticipantSchema
>;

export type ListChatSessionsQueryRequest = z.infer<
  typeof listChatSessionsQuerySchema
>;
