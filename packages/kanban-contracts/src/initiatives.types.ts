import type { z } from "zod";
import type {
  CreateInitiativeRequestSchema,
  InitiativeHorizonSchema,
  InitiativeSchema,
  InitiativeStatusSchema,
  UpdateInitiativeRequestSchema,
  UpdateInitiativeStatusRequestSchema,
} from "./initiatives.schema";

export type InitiativeHorizon = z.infer<typeof InitiativeHorizonSchema>;
export type InitiativeStatus = z.infer<typeof InitiativeStatusSchema>;
export type Initiative = z.infer<typeof InitiativeSchema>;
export type CreateInitiativeRequest = z.infer<
  typeof CreateInitiativeRequestSchema
>;
export type UpdateInitiativeRequest = z.infer<
  typeof UpdateInitiativeRequestSchema
>;
export type UpdateInitiativeStatusRequest = z.infer<
  typeof UpdateInitiativeStatusRequestSchema
>;
