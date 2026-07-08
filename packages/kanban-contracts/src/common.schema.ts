import { z } from "zod";

export const TimestampFieldsSchema = z
  .object({
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const CamelTimestampFieldsSchema = z
  .object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
