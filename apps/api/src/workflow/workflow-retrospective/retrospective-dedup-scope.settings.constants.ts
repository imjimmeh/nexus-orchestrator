/**
 * FU-16: config-gated widening of the retrospective dedup blast radius.
 *
 * `RetrospectiveAnalysisService.isAlreadyKnown` always deduped a finding
 * against `project(scopeId) + global` memory only — the acting agent-profile
 * and workflow identity resolved during dispatch (`resolveActingAgentProfiles`,
 * `resolveOriginalWorkflowYaml`/`resolveOriginalWorkflowDetails`) were never
 * threaded into the dedup query, even though `MemoryRetrievalService` already
 * supports an `agent(<name>)` + `workflow(<name>)` pool union.
 *
 * This setting is a kill switch, default OFF: a fresh/existing deployment
 * keeps the exact current dedup pool (project+global) until an operator
 * explicitly opts in to widening it. Re-read on every dedup check (via
 * `SystemSettingsService.get`) so the operator can toggle it without a
 * restart.
 */
export const RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING =
  'retrospective_dedup_widen_scope';
export const RETROSPECTIVE_DEDUP_WIDEN_SCOPE_DEFAULT = false;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry
 * (`system-settings.defaults.ts`) so a fresh database seeds this kill switch
 * with its canonical (OFF) default and a UI description.
 */
export const RETROSPECTIVE_DEDUP_SCOPE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING]: {
    value: RETROSPECTIVE_DEDUP_WIDEN_SCOPE_DEFAULT,
    description:
      'When true, RetrospectiveAnalysisService.isAlreadyKnown widens its dedup-against-known-memory check beyond project+global to also consult the acting agent-profile and workflow memory pools. Defaults to false so dedup behavior is unchanged until an operator opts in.',
  },
};
