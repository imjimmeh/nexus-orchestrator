import { z } from "zod";
import { RunnerThinkingLevelSchema } from "./thinking-level.schema";

export const CreateModelSchema = z.object({
  name: z.string().min(1),
  provider_name: z.string().optional(),
  token_limit: z.number().int().min(1).optional(),
  input_token_cents_per_million: z.number().int().min(0).nullable().optional(),
  output_token_cents_per_million: z.number().int().min(0).nullable().optional(),
  default_for_execution: z.boolean().optional(),
  default_for_distillation: z.boolean().optional(),
  default_for_summarization: z.boolean().optional(),
  default_for_session: z.boolean().optional(),
  is_active: z.boolean().optional(),
  supports_embedding: z.boolean().optional(),
  embedding_dimension: z.number().int().min(1).nullable().optional(),
  default_for_embedding: z.boolean().optional(),
  default_thinking_level: RunnerThinkingLevelSchema.nullable().optional(),
});

export const UpdateModelSchema = CreateModelSchema.partial();

export * from "./models.types";
