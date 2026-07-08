// packages/core/src/schemas/harness/index.ts
export {
  CanonicalSessionEventSchema,
  TurnOutputSchema,
} from "./session-events.schema";
export type {
  CanonicalSessionEvent,
  TurnOutput,
} from "./session-events.schema";

export { CanonicalCommandSchema } from "./commands.schema";
export type { CanonicalCommand } from "./commands.schema";

export {
  COMMAND_STARTED_EVENT,
  COMMAND_OUTPUT_EVENT,
  COMMAND_FINISHED_EVENT,
} from "./command-events";
export type {
  CommandStartedPayload,
  CommandOutputPayload,
  CommandFinishedPayload,
} from "./command-events";
