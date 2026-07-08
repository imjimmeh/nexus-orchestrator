import type { z } from "zod";
import type {
  RecordStrategicIntentRequestSchema,
  StrategicIntentSchema,
  StrategicStalenessSchema,
} from "./strategic.schema";

export type StrategicStaleness = z.infer<typeof StrategicStalenessSchema>;
export type StrategicIntent = z.infer<typeof StrategicIntentSchema>;
export type RecordStrategicIntentRequest = z.infer<
  typeof RecordStrategicIntentRequestSchema
>;
