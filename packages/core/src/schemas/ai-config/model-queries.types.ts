import { z } from "zod";
import type { ListModelsQuerySchema } from "./model-queries.schema";

export type ListModelsQuery = z.infer<typeof ListModelsQuerySchema>;
