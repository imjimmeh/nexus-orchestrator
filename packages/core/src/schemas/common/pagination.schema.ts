import { z } from "zod";

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const PaginationMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export type { PaginationQuery, PaginationMeta };
