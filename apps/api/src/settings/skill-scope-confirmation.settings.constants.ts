/**
 * Operator-tunable knob controlling whether an analyst-recommended skill scope
 * auto-applies immediately (`auto`), parks for human review (`manual`, default),
 * or parks with an eligibility flag for a future staged-confirm flow (`staged`).
 *
 * EPIC-212 Phase 4, Task 7.
 */

import type { SkillScopeConfirmationMode } from './skill-scope-confirmation.settings.constants.types';

export const SKILL_SCOPE_CONFIRMATION_MODE_KEY =
  'skill_scope_confirmation_mode';

export const SKILL_SCOPE_CONFIRMATION_MODE_DEFAULT: SkillScopeConfirmationMode =
  'manual';

/**
 * Coerce an unknown settings value to a valid {@link SkillScopeConfirmationMode}.
 * Returns the default (`manual`) for any unrecognised value — never throws.
 */
export function coerceSkillScopeConfirmationMode(
  value: unknown,
): SkillScopeConfirmationMode {
  if (value === 'auto' || value === 'staged') {
    return value;
  }
  return SKILL_SCOPE_CONFIRMATION_MODE_DEFAULT;
}

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * confirmation mode seeds with its canonical default and a UI description.
 */
export const SKILL_SCOPE_CONFIRMATION_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [SKILL_SCOPE_CONFIRMATION_MODE_KEY]: {
    value: SKILL_SCOPE_CONFIRMATION_MODE_DEFAULT,
    description:
      'Scope-confirmation mode for auto-applied skill proposals (EPIC-212 Phase 4). ' +
      '`manual` (default) — always parks the recommended scope as pending:true for human review. ' +
      '`staged` — parks pending:true but marks the row as eligible for a future bulk-confirm pass. ' +
      '`auto` — immediately applies the recommended scope to the skill frontmatter when the analyst ' +
      'returns a non-empty scope; empty/null scopes always fall back to pending:true.',
  },
};
