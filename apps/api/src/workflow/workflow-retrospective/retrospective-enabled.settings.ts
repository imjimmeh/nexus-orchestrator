/**
 * Master kill-switch for the EPIC-212 Phase-2 retrospective analyst loop.
 *
 * `retrospective_enabled` gates the ENTIRE analyst path:
 *   - the enqueue listener early-returns (no `retrospective_queue` row, no gate
 *     score) when disabled, and
 *   - the budget-capped drain no-ops when disabled.
 *
 * With the switch OFF (the default) only the deterministic Phase-0/1 loop runs
 * (struggle candidates, clustering, scoring, vector injection); the expensive
 * LLM analyst half is entirely inert. The key and resolver live here so a future
 * rename touches a single site, and so both the listener (workflow-retrospective)
 * and the drain read the switch through one shared helper.
 *
 * The defaults fragment is spread into `SYSTEM_SETTING_DEFAULTS` so a fresh
 * database returns `false`. The `SystemSettingsService` import is type-only, so
 * seeding this fragment from `system-settings.defaults.ts` introduces no
 * circular runtime dependency.
 */
import type { SystemSettingsService } from '../../settings/system-settings.service';

/** Setting key for the retrospective-analyst master kill-switch. */
export const RETROSPECTIVE_ENABLED_SETTING = 'retrospective_enabled';

/** Default: OFF — the analyst loop is opt-in (Phase-0/1 deterministic loop only). */
export const RETROSPECTIVE_ENABLED_DEFAULT = false;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * master kill-switch seeds on a fresh DB with its canonical default (`false`)
 * and a UI description.
 */
export const RETROSPECTIVE_ENABLED_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [RETROSPECTIVE_ENABLED_SETTING]: {
    value: RETROSPECTIVE_ENABLED_DEFAULT,
    description:
      'Master kill-switch for the EPIC-212 Phase-2 retrospective analyst loop. When false (default) terminal runs are not enqueued, the drain no-ops, and no LLM retrospective runs — only the deterministic Phase-0/1 learning loop (struggle candidates, clustering, scoring, vector injection) stays active. Set to true to enable the analyst-driven mining/routing/governance pipeline.',
  },
};

/**
 * Read the `retrospective_enabled` master kill-switch. Defaults to `false` so a
 * missing or malformed setting keeps the analyst loop inert; a strict
 * `=== true` comparison means only the literal boolean `true` enables it.
 */
export async function resolveRetrospectiveEnabled(
  settings: SystemSettingsService,
): Promise<boolean> {
  const raw = await settings.get<unknown>(
    RETROSPECTIVE_ENABLED_SETTING,
    RETROSPECTIVE_ENABLED_DEFAULT,
  );
  return raw === true;
}
