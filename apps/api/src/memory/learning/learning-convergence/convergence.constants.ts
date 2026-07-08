/**
 * Runtime constants for the daily convergence recorder's
 * BullMQ surface (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 3).
 *
 * Centralises the BullMQ queue name, the repeatable-job name,
 * and the stable `jobId` the cron scheduler keys the repeat
 * schedule by. Mirrors the convention used by the three
 * sibling memory reapers (`memory-eviction.constants.ts`,
 * `memory-decay.constants.ts`, `memory-drift.constants.ts`):
 * the runtime identifiers live next to the recorder so the
 * scheduler / processor / reaper all read the same constants
 * without going through the settings module.
 *
 * `MEMORY_CONVERGENCE_REPEAT_JOB_ID` is the BullMQ `jobId`
 * the scheduler passes to `queue.add(...)`. BullMQ keys
 * repeat schedules by this id, so a subsequent bootstrap
 * with the same id replaces the existing schedule (which is
 * exactly what we want when an operator updates the
 * `learning_convergence_cron` SystemSetting and the next
 * bootstrap re-reads the value). This is the same
 * migration contract `MemoryCronScheduler` already pins for
 * the three sibling reapers.
 */

/**
 * BullMQ queue name for the daily convergence recorder pass.
 * A separate queue from the three sibling memory reapers
 * (`memory-eviction`, `memory-decay`, `memory-drift`) keeps
 * the recorder's BullMQ repeat-schedule state disjoint so
 * an operator can pause / restart the recorder independently
 * of the reaper trio (and vice versa). The
 * `ConvergenceSnapshotProcessor` (@Processor) is wired on this
 * queue at module construction time.
 */
export const MEMORY_CONVERGENCE_SNAPSHOT_QUEUE = 'convergence-snapshot';

/**
 * BullMQ repeatable-job name for the daily recorder tick.
 * The processor only handles this name; any other name that
 * lands in the queue is logged and returned as a no-op so an
 * accidental `queue.add('something-else', ...)` from an
 * admin tool does not crash the worker. Operators can also
 * enqueue a one-shot job with this name from an admin
 * trigger handler to run the recorder on-demand without
 * waiting for the next cron tick (AC-4 — manual trigger
 * dedicated).
 */
export const MEMORY_CONVERGENCE_JOB_NAME = 'convergence-snapshot-record';

/**
 * Stable `jobId` used when registering the recorder's
 * repeatable job with BullMQ. BullMQ keys the repeat
 * schedule by this id, so a subsequent `queue.add` with the
 * same id replaces the existing schedule — which is exactly
 * what we want when an operator updates the
 * `learning_convergence_cron` SystemSetting and the next
 * bootstrap re-reads the value.
 *
 * The literal MUST stay byte-for-byte identical across the
 * scheduler and any future migration site — an accidental
 * rename would orphan the existing schedule on the next
 * bootstrap and double-fire the recorder on the next cron
 * tick.
 */
export const MEMORY_CONVERGENCE_REPEAT_JOB_ID = 'memory-convergence-cron';
