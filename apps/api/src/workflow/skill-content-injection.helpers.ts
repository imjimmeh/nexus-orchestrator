import type { InjectableSkill } from './skill-content-injection.helpers.types';

export const DEFAULT_SKILL_CONTENT_BUDGET_TOKENS = 6000;

/**
 * Resolves the token budget for inline skill-content injection.
 * Reads `SKILL_CONTENT_BUDGET_TOKENS` from the environment; falls back to
 * `DEFAULT_SKILL_CONTENT_BUDGET_TOKENS` when the variable is absent, not a
 * finite integer, zero, or negative.
 */
export function resolveSkillContentBudgetTokens(): number {
  const raw = process.env.SKILL_CONTENT_BUDGET_TOKENS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SKILL_CONTENT_BUDGET_TOKENS;
}

const INJECT_HEADER =
  'Assigned skills — full instructions are included inline below. Apply them directly; you do not need to open any file to use a skill shown here.';
const OVERFLOW_HEADER =
  'These additional assigned skills did not fit inline and are mounted on disk — read their SKILL.md when a task calls for them:';

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Render assigned skills as inline `<skill>` blocks containing their full
 * markdown body, greedily filling a token budget in assignment order. Skills
 * whose block would exceed the remaining budget are listed by name/description
 * instead (they remain available via the on-disk mount). Returns '' when no
 * skills are assigned.
 */
export function renderInjectedSkillContent(params: {
  skills: InjectableSkill[];
  budgetTokens: number;
  countTokens?: (text: string) => number;
}): string {
  const skills = params.skills ?? [];
  if (skills.length === 0) {
    return '';
  }

  const count = params.countTokens ?? estimateTokens;
  const blocks: string[] = [];
  const overflow: InjectableSkill[] = [];
  let used = 0;

  for (const skill of skills) {
    const block = `<skill name="${skill.name}">\n${skill.skillMarkdown.trim()}\n</skill>`;
    const cost = count(block);
    if (used + cost <= params.budgetTokens) {
      blocks.push(block);
      used += cost;
    } else {
      overflow.push(skill);
    }
  }

  const sections: string[] = [];
  if (blocks.length > 0) {
    sections.push([INJECT_HEADER, ...blocks].join('\n\n'));
  }
  if (overflow.length > 0) {
    const lines = overflow.map((s) => `- ${s.name} — ${s.description}`);
    sections.push([OVERFLOW_HEADER, ...lines].join('\n'));
  }
  return sections.join('\n\n');
}
