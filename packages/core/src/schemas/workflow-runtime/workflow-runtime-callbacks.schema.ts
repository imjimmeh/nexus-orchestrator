import { z } from "zod";
import { dispatchStartContextItemsBodySchema } from "./workflow-runtime-lifecycle.schema";

const optionalTrimmedNonBlankString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().trim().min(1).optional(),
);

export const internalToolCallbackBodySchema = z
  .object({
    workflow_run_id: optionalTrimmedNonBlankString,
    job_id: optionalTrimmedNonBlankString,
  })
  .loose();

export const dispatchStartContextItemsCallbackBodySchema =
  internalToolCallbackBodySchema.extend(
    dispatchStartContextItemsBodySchema.shape,
  );

export type InternalToolCallbackBody = z.infer<
  typeof internalToolCallbackBodySchema
>;
export type DispatchStartContextItemsCallbackBody = z.infer<
  typeof dispatchStartContextItemsCallbackBodySchema
>;
