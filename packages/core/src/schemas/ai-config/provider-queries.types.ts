import { z } from "zod";
import type { ListProvidersQuerySchema } from "./provider-queries.schema";

export type ListProvidersQuery = z.infer<typeof ListProvidersQuerySchema>;
