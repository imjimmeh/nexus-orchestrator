import { z } from "zod";

export const NEXUS_SUBAGENT_TIERS = ["light", "heavy"] as const;
export const NexusSubagentTierSchema = z.enum(NEXUS_SUBAGENT_TIERS);

export const NEXUS_MENTION_URGENCIES = ["normal", "high"] as const;
export const NexusMentionUrgencySchema = z.enum(NEXUS_MENTION_URGENCIES);

export const NEXUS_CHAT_PARTICIPANT_ROLES = [
  "participant",
  "moderator",
] as const;
export const NexusChatParticipantRoleSchema = z.enum(
  NEXUS_CHAT_PARTICIPANT_ROLES,
);

export const NEXUS_WAR_ROOM_PARTICIPANT_ROLES = [
  "architect",
  "dev",
  "qa",
  "pm",
  "moderator",
] as const;
export const NexusWarRoomParticipantRoleSchema = z.enum(
  NEXUS_WAR_ROOM_PARTICIPANT_ROLES,
);

export const NEXUS_WAR_ROOM_MESSAGE_KINDS = [
  "proposal",
  "question",
  "response",
  "system",
] as const;
export const NexusWarRoomMessageKindSchema = z.enum(
  NEXUS_WAR_ROOM_MESSAGE_KINDS,
);

export const NEXUS_WAR_ROOM_SIGNOFF_DECISIONS = [
  "approved",
  "changes_requested",
  "blocked",
] as const;
export const NexusWarRoomSignoffDecisionSchema = z.enum(
  NEXUS_WAR_ROOM_SIGNOFF_DECISIONS,
);

export const NEXUS_WAR_ROOM_RESOLUTION_TYPES = [
  "consensus",
  "deadlock",
  "ceo_tie_break",
  "manual",
] as const;
export const NexusWarRoomResolutionTypeSchema = z.enum(
  NEXUS_WAR_ROOM_RESOLUTION_TYPES,
);
