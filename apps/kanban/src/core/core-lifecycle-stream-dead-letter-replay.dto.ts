import { z } from "zod";

/**
 * Request body for `POST internal/core/lifecycle-stream/dead-letters/replay`.
 * An empty/absent body replays every parked dead-letter row; supplying
 * `proposalIds` scopes the replay to just those proposals.
 */
export const replayDeadLettersRequestSchema = z.object({
  proposalIds: z.array(z.string().trim().min(1)).optional(),
});
