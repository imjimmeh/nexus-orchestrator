import type { z } from "zod";

import type {
  KanbanWorkItemEventEnvelopeV1Schema,
  KanbanWorkItemEventPayloadV1Schema,
  KanbanWorkItemEventTypeV1Schema,
} from "./events.schema";

export type KanbanWorkItemEventTypeV1 = z.infer<
  typeof KanbanWorkItemEventTypeV1Schema
>;
export type KanbanWorkItemEventPayloadV1 = z.infer<
  typeof KanbanWorkItemEventPayloadV1Schema
>;
export type KanbanWorkItemEventEnvelopeV1 = z.infer<
  typeof KanbanWorkItemEventEnvelopeV1Schema
>;
