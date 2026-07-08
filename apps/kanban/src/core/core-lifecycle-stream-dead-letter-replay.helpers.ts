import { extractProposalId } from "../database/repositories/kanban-core-lifecycle-dead-letter.repository.helpers";
import type {
  DeadLetterReplayDeps,
  DeadLetterReplayOptions,
  DeadLetterReplayResult,
} from "./core-lifecycle-stream-dead-letter-replay.types";

interface DeadLetterRow {
  readonly id: string;
  readonly payload: Record<string, unknown> | null;
}

interface RowOutcome {
  readonly replayed: boolean;
  readonly skipped: boolean;
  readonly deleted: boolean;
}

/**
 * Re-emits stored dead-letter payloads back onto the lifecycle stream
 * verbatim, deleting each row once its event is safely re-published. Distinct
 * from cursor-forward replay: it never touches the forward cursor, so it can
 * reach rows the cursor has already advanced past. Re-emitted events flow
 * back through the normal consumer poll and are deduped downstream by proposal
 * id (idempotent either way — filed if the project is now configured,
 * re-parked otherwise).
 *
 * Drains the backlog in batches: {@link DeadLetterReplayDeps.deadLetters}'s
 * `listDeadLetters` is bounded (repo default), so a single fetch cannot see an
 * arbitrarily large backlog. The loop keeps fetching and processing while a
 * batch makes real progress (deletes at least one row) and stops once a batch
 * deletes nothing — which guarantees termination even when some rows are
 * filtered out, un-deletable, or fail to publish. Each distinct row is
 * published at most once per call (tracked by id), so a row that publishes but
 * then fails to delete is never re-emitted within the same call. The returned
 * `remaining` count reflects rows still parked after the drain.
 *
 * Publish and delete are handled separately so their failure modes don't
 * conflate: a publish failure leaves the row untouched (not on the stream) and
 * counts as `skipped`; a publish success counts as `replayed` immediately (the
 * event is already on the stream), and a subsequent delete failure only logs a
 * distinct warning — the leftover row is safe because downstream is idempotent
 * by proposal id.
 */
export async function replayDeadLetters(
  deps: DeadLetterReplayDeps,
  opts?: DeadLetterReplayOptions,
): Promise<DeadLetterReplayResult> {
  const { logger, deadLetters } = deps;
  const proposalIdFilter = opts?.proposalIds?.length
    ? new Set(opts.proposalIds)
    : null;

  let replayed = 0;
  let skipped = 0;
  const processedRowIds = new Set<string>();

  for (;;) {
    const rows = await deadLetters.listDeadLetters();
    if (rows.length === 0) {
      break;
    }

    let deletedThisBatch = 0;

    for (const row of rows) {
      // Already handled this call — never re-count or re-publish. This is what
      // makes the loop terminate when the fetch window keeps returning the same
      // filtered-out or un-deletable rows.
      if (processedRowIds.has(row.id)) {
        continue;
      }
      processedRowIds.add(row.id);

      const outcome = await processDeadLetterRow(deps, row, proposalIdFilter);
      if (outcome.replayed) replayed += 1;
      if (outcome.skipped) skipped += 1;
      if (outcome.deleted) deletedThisBatch += 1;
    }

    // No row was deleted this batch → every remaining row is filtered out,
    // already processed, or un-deletable. Stop to guarantee termination.
    if (deletedThisBatch === 0) {
      break;
    }
  }

  const remaining = await deadLetters.countRecent();

  logger.log(
    `Replayed ${replayed} dead-lettered core lifecycle stream entries (${skipped} skipped, ${remaining} remaining)`,
  );

  return { replayed, skipped, remaining };
}

/**
 * Handles a single dead-letter row: applies the optional proposalId filter,
 * re-publishes the payload, then attempts to delete the row. Publish and
 * delete failures are reported distinctly (see {@link replayDeadLetters}).
 */
async function processDeadLetterRow(
  deps: DeadLetterReplayDeps,
  row: DeadLetterRow,
  proposalIdFilter: Set<string> | null,
): Promise<RowOutcome> {
  const { logger, deadLetters } = deps;

  if (proposalIdFilter) {
    const proposalId = extractProposalId(row.payload);
    if (!proposalId || !proposalIdFilter.has(proposalId)) {
      return { replayed: false, skipped: true, deleted: false };
    }
  }

  // Publish first. A publish failure leaves the row on disk and off the
  // stream, so it is a plain skip.
  try {
    await republishDeadLetterPayload(deps, row.payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to replay dead letter ${row.id}: ${reason}`);
    return { replayed: false, skipped: true, deleted: false };
  }

  // Published: the event is now on the stream, so the row counts as replayed
  // regardless of whether we can subsequently clear it.
  try {
    await deadLetters.deleteDeadLetter(row.id);
    return { replayed: true, skipped: false, deleted: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Replayed dead letter ${row.id} but failed to clear the dead-letter row: ${reason}`,
    );
    return { replayed: true, skipped: false, deleted: false };
  }
}

async function republishDeadLetterPayload(
  deps: Pick<DeadLetterReplayDeps, "redis" | "streamKey">,
  payload: Record<string, unknown> | null,
): Promise<void> {
  if (!payload) {
    throw new Error("Dead letter row has no payload to replay");
  }

  const entries = Object.entries(payload).flatMap(([key, value]) => [
    key,
    String(value),
  ]);
  await deps.redis.xadd(deps.streamKey, "*", ...entries);
}
