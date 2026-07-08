/**
 * `PostmortemSettingsResolver` — milestone 1 of work item
 * 71cdcd7b-daff-489d-b681-44d239765c99.
 *
 * Owns the resolution of `WorkflowFailurePostmortemListener`'s
 * kill-switch + writeback-delay settings from `SystemSettingsService`.
 *
 * Extracted out of the listener so the listener's branchy logic
 * stays under the project's `max-lines` lint cap and so the
 * settings resolution can be unit-tested directly (without the
 * listener's full collaborator graph).
 *
 * The contract mirrors `MemoryDecayReaperService.resolveSettings`:
 *   - `coerceEnabled` for the kill switch — accepts booleans, the
 *     0/1 numeric shorthand, and `"true"` / `"false"` strings
 *     (operator-convenience form); other values fall back to
 *     `WORKFLOW_POSTMORTEM_DEFAULT_ENABLED` so a malformed stored
 *     value never silently disables the postmortem writeback.
 *   - `coerceDelaySeconds` for the writeback delay — accepts any
 *     non-negative number (fractional values floor to the nearest
 *     integer); negative values, non-numeric strings, and `NaN`
 *     fall back to `WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS`.
 *
 * Settings are read fresh on every call (no construction-time
 * caching) so an operator can toggle the kill switch between
 * events without restarting the app.
 *
 * NOTE: This service is NOT yet wired into
 * `WorkflowFailurePostmortemListener` — that lands in milestone 4.
 * For this milestone the service is created in isolation; the
 * listener still owns the same `resolveSettings()` logic in
 * duplicate.
 */
import { Injectable } from '@nestjs/common';
import { coerceEnabled } from '../../memory/memory-decay.reaper';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
  WORKFLOW_POSTMORTEM_DEFAULT_ENABLED,
  WORKFLOW_POSTMORTEM_SETTING_KEYS,
} from './workflow-failure-postmortem.constants';
import type { ResolvedPostmortemSettings } from './postmortem-settings-resolver.types';

@Injectable()
export class PostmortemSettingsResolver {
  constructor(private readonly settings: SystemSettingsService) {}

  /**
   * Resolve the live postmortem writeback settings.
   *
   * Mirrors the listener's existing in-file `resolveSettings` —
   * `coerceEnabled` for the kill switch, a non-negative integer
   * floor for the delay. Settings are read fresh on every call
   * (no construction-time caching) so an operator can toggle the
   * kill switch between events without an app restart.
   */
  async resolveSettings(): Promise<ResolvedPostmortemSettings> {
    const rawEnabled = await this.settings.get<unknown>(
      WORKFLOW_POSTMORTEM_SETTING_KEYS.enabled,
      WORKFLOW_POSTMORTEM_DEFAULT_ENABLED,
    );
    const enabled = coerceEnabled(
      rawEnabled,
      WORKFLOW_POSTMORTEM_DEFAULT_ENABLED,
    );

    const rawDelaySeconds = await this.settings.get<unknown>(
      WORKFLOW_POSTMORTEM_SETTING_KEYS.delaySeconds,
      WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
    );
    const delaySeconds = coerceDelaySeconds(rawDelaySeconds);

    return { enabled, delaySeconds };
  }
}

/**
 * Coerce the `workflow_postmortem_writeback_delay_seconds` setting
 * into a non-negative integer.
 *
 *   - `0` is a legitimate value: the listener's `sleep(delaySeconds * 1000)`
 *     becomes a no-op when the operator wants the postmortem
 *     written back immediately (dev / test stacks, or envs where
 *     the repair dispatch is intentionally disabled).
 *   - Fractional positive values floor to the nearest integer so
 *     a stored `0.7s` typo doesn't accidentally inflate the sleep
 *     into hours.
 *   - Negative values (which would be ambiguous with the
 *     kill-switch-off path) and non-numeric strings (`"abc"`,
 *     `""`, `undefined`, `null`) fall back to the default so a
 *     malformed stored value never silently disables the
 *     postmortem's `await sleep(...)` step.
 *
 * Private to this module — the only sanctioned entry point is
 * `PostmortemSettingsResolver.resolveSettings`, which feeds the
 * resolved delay into the listener's sleep gate.
 */
function coerceDelaySeconds(
  value: unknown,
  fallback: number = WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.floor(numeric);
}
