import { z } from "zod";
import { CreateModelSchema, UpdateModelSchema } from "./models.schema";

export type CreateModelRequest = z.infer<typeof CreateModelSchema>;
export type UpdateModelRequest = z.infer<typeof UpdateModelSchema>;
