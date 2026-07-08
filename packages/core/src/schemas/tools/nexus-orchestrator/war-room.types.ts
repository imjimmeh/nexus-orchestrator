import { z } from "zod";
import {
  OpenWarRoomSchema,
  InviteWarRoomParticipantSchema,
  PostWarRoomMessageSchema,
  UpdateWarRoomBlackboardSchema,
  SubmitWarRoomSignoffSchema,
  GetWarRoomStateSchema,
  CloseWarRoomSchema,
} from "./war-room.schemas";

export type OpenWarRoomInput = z.infer<typeof OpenWarRoomSchema>;
export type InviteWarRoomParticipantInput = z.infer<
  typeof InviteWarRoomParticipantSchema
>;
export type PostWarRoomMessageInput = z.infer<typeof PostWarRoomMessageSchema>;
export type UpdateWarRoomBlackboardInput = z.infer<
  typeof UpdateWarRoomBlackboardSchema
>;
export type SubmitWarRoomSignoffInput = z.infer<
  typeof SubmitWarRoomSignoffSchema
>;
export type GetWarRoomStateInput = z.infer<typeof GetWarRoomStateSchema>;
export type CloseWarRoomInput = z.infer<typeof CloseWarRoomSchema>;
