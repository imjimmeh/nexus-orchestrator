/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the scheduled-jobs automation
 * knobs (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 2).
 *
 * Keys are imported from `../automation/scheduled-jobs.constants` so
 * the BullMQ scheduler registration, the polling tick, and the seeded
 * defaults can never drift apart. The polling tick re-reads the keys
 * via `SystemSettingsService.get()` on every iteration so operator
 * changes take effect on the next tick without restarting the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
import {
  SCHEDULED_JOBS_ENABLED_KEY,
  SCHEDULED_JOBS_POLL_INTERVAL_SECONDS_KEY,
  SCHEDULED_JOBS_POLL_BATCH_SIZE_KEY,
} from '../automation/scheduled-jobs.constants';

export const SCHEDULED_JOBS_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [SCHEDULED_JOBS_ENABLED_KEY]: {
    value: true,
    description: 'Enable scheduled jobs automation queue processing',
  },
  [SCHEDULED_JOBS_POLL_INTERVAL_SECONDS_KEY]: {
    value: 30,
    description:
      'Polling cadence in seconds for discovering due scheduled jobs',
  },
  [SCHEDULED_JOBS_POLL_BATCH_SIZE_KEY]: {
    value: 50,
    description:
      'Maximum number of due scheduled jobs evaluated per polling tick',
  },
};
