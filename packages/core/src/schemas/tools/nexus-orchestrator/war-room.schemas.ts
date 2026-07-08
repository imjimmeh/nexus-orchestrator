import { z } from "zod";
import {
  NexusWarRoomParticipantRoleSchema,
  NexusWarRoomMessageKindSchema,
  NexusWarRoomSignoffDecisionSchema,
  NexusWarRoomResolutionTypeSchema,
} from "./constants.js";

const WarRoomParticipantSchema = z
  .object({
    agent_profile: z.string().trim().min(1),
    role: NexusWarRoomParticipantRoleSchema,
    execution_id: z.string().trim().min(1).optional(),
  })
  .strict();

export const OpenWarRoomSchema = z
  .object({
    action: z.literal("open_war_room"),
    session_id: z.string().trim().min(1).optional(),
    scope_id: z.string().trim().min(1).optional(),
    context_id: z.string().trim().min(1).optional(),
    participants: z.array(WarRoomParticipantSchema).optional(),
    initial_message: z.string().trim().min(1).optional(),
  })
  .strict();

export const InviteWarRoomParticipantSchema = z
  .object({
    action: z.literal("invite_war_room_participant"),
    session_id: z.string().trim().min(1),
    agent_profile: z.string().trim().min(1).optional(),
    target_agent_profile: z.string().trim().min(1).optional(), // Legacy alias
    role: NexusWarRoomParticipantRoleSchema,
  })
  .strict();

export const PostWarRoomMessageSchema = z
  .object({
    action: z.literal("post_war_room_message"),
    session_id: z.string().trim().min(1),
    message_kind: NexusWarRoomMessageKindSchema,
    body: z.string().trim().min(1),
  })
  .strict();

export const UpdateWarRoomBlackboardSchema = z
  .object({
    action: z.literal("update_war_room_blackboard"),
    session_id: z.string().trim().min(1),
    expected_version: z.number().int().nonnegative().optional(),
    strategy_summary: z.string().trim().min(1).optional(),
    risks: z.array(z.any()).optional(),
    decision_log: z.array(z.any()).optional(),
    implementation_plan_ref: z.string().trim().min(1).optional(),
  })
  .strict();

export const SubmitWarRoomSignoffSchema = z
  .object({
    action: z.literal("submit_war_room_signoff"),
    session_id: z.string().trim().min(1),
    role: NexusWarRoomParticipantRoleSchema,
    agent_profile: z.string().trim().min(1).optional(),
    decision: NexusWarRoomSignoffDecisionSchema,
    rationale: z.string().trim().min(1).optional(),
  })
  .strict();

export const GetWarRoomStateSchema = z
  .object({
    action: z.literal("get_war_room_state"),
    session_id: z.string().trim().min(1),
  })
  .strict();

export const CloseWarRoomSchema = z
  .object({
    action: z.literal("close_war_room"),
    session_id: z.string().trim().min(1),
    resolution_type: NexusWarRoomResolutionTypeSchema.optional(),
    resolution_note: z.string().trim().min(1).optional(),
  })
  .strict();

export * from "./war-room.types";
