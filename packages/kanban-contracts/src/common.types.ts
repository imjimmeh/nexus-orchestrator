import type { z } from "zod";

import type {
  CamelTimestampFieldsSchema,
  TimestampFieldsSchema,
} from "./common.schema";

export type TimestampFields = z.infer<typeof TimestampFieldsSchema>;
export type CamelTimestampFields = z.infer<typeof CamelTimestampFieldsSchema>;
