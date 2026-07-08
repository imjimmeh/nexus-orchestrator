import { z } from "zod";
import { KANBAN_RETROSPECTIVE_RUN_STATUSES } from "../retrospective.types";

const optionalNonEmptyStringSchema = z.string().trim().min(1).optional();

const parseOptionalIntegerQuery = (value: unknown): unknown => {
  if (typeof value !== "string") return value;

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) return value;

  return Number(trimmedValue);
};

const optionalPositiveIntegerQuerySchema = z.preprocess(
  parseOptionalIntegerQuery,
  z.number().int().positive().optional(),
);

const optionalNonNegativeIntegerQuerySchema = z.preprocess(
  parseOptionalIntegerQuery,
  z.number().int().min(0).optional(),
);

export const listRetrospectivesSchema = z.object({
  project_id: optionalNonEmptyStringSchema,
  status: z.enum(KANBAN_RETROSPECTIVE_RUN_STATUSES).optional(),
  limit: optionalPositiveIntegerQuerySchema,
  offset: optionalNonNegativeIntegerQuerySchema,
});
