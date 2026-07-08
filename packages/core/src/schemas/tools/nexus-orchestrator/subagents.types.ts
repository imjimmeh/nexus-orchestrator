import { z } from "zod";
import {
  SpawnSubagentAsyncSchema,
  WaitForSubagentsSchema,
  CheckSubagentStatusSchema,
} from "./subagents.schemas";

export type SpawnSubagentAsyncInput = z.infer<typeof SpawnSubagentAsyncSchema>;
export type WaitForSubagentsInput = z.infer<typeof WaitForSubagentsSchema>;
export type CheckSubagentStatusInput = z.infer<
  typeof CheckSubagentStatusSchema
>;
