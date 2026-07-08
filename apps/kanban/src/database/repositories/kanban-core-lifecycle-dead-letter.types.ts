import type { KanbanCoreLifecycleDeadLetterEntity } from "../entities/kanban-core-lifecycle-dead-letter.entity";

export type CoreLifecycleDeadLetterInput = Pick<
  KanbanCoreLifecycleDeadLetterEntity,
  "stream_key" | "stream_id" | "reason" | "payload"
>;
