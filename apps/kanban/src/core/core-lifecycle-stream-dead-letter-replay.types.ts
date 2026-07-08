import type { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { KanbanCoreLifecycleDeadLetterRepository } from "../database/repositories/kanban-core-lifecycle-dead-letter.repository";

/**
 * Dependencies for {@link replayDeadLetters}. Bundled into a struct so the
 * helper can be unit-tested in isolation (the lifecycle consumer passes real
 * services; the unit test passes permissive fakes).
 */
export interface DeadLetterReplayDeps {
  readonly logger: Logger;
  readonly redis: Redis;
  readonly deadLetters: KanbanCoreLifecycleDeadLetterRepository;
  readonly streamKey: string;
}

export interface DeadLetterReplayOptions {
  readonly proposalIds?: string[];
}

export interface DeadLetterReplayResult {
  /** Rows whose event was successfully re-published onto the stream. */
  readonly replayed: number;
  /**
   * Rows that were not re-published this call: filtered out by `proposalIds`,
   * or whose re-publish threw (left untouched, not on the stream).
   */
  readonly skipped: number;
  /**
   * Dead-letter rows still present after the drain loop. Non-zero means the
   * backlog was not fully cleared — e.g. a `proposalIds` filter left
   * non-matching rows behind, or a row could not be deleted after its event
   * was re-published. Operators should re-run (or investigate) until this
   * reaches zero.
   */
  readonly remaining: number;
}
