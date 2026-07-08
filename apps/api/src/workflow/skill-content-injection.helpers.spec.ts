import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
  renderInjectedSkillContent,
  resolveSkillContentBudgetTokens,
} from './skill-content-injection.helpers';

const wordCount = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

describe('resolveSkillContentBudgetTokens', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.SKILL_CONTENT_BUDGET_TOKENS;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.SKILL_CONTENT_BUDGET_TOKENS;
    } else {
      process.env.SKILL_CONTENT_BUDGET_TOKENS = savedEnv;
    }
  });

  it('returns the default when the env var is not set', () => {
    delete process.env.SKILL_CONTENT_BUDGET_TOKENS;
    expect(resolveSkillContentBudgetTokens()).toBe(
      DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
    );
  });

  it('returns the parsed value when the env var is a valid positive integer', () => {
    process.env.SKILL_CONTENT_BUDGET_TOKENS = '12000';
    expect(resolveSkillContentBudgetTokens()).toBe(12000);
  });

  it('returns the default when the env var is set to zero', () => {
    process.env.SKILL_CONTENT_BUDGET_TOKENS = '0';
    expect(resolveSkillContentBudgetTokens()).toBe(
      DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
    );
  });

  it('returns the default when the env var is a negative number', () => {
    process.env.SKILL_CONTENT_BUDGET_TOKENS = '-500';
    expect(resolveSkillContentBudgetTokens()).toBe(
      DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
    );
  });

  it('returns the default when the env var is not a valid number', () => {
    process.env.SKILL_CONTENT_BUDGET_TOKENS = 'not-a-number';
    expect(resolveSkillContentBudgetTokens()).toBe(
      DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
    );
  });
});

describe('renderInjectedSkillContent', () => {
  it('returns empty string when no skills are assigned', () => {
    expect(renderInjectedSkillContent({ skills: [], budgetTokens: 100 })).toBe(
      '',
    );
  });

  it('inlines full skill bodies that fit within budget', () => {
    const out = renderInjectedSkillContent({
      skills: [
        {
          name: 'debugging',
          description: 'find bugs',
          skillMarkdown: 'Step 1 isolate.',
        },
        {
          name: 'tdd',
          description: 'red green',
          skillMarkdown: 'Write the test first.',
        },
      ],
      budgetTokens: 1000,
      countTokens: wordCount,
    });
    expect(out).toContain('<skill name="debugging">');
    expect(out).toContain('Step 1 isolate.');
    expect(out).toContain('<skill name="tdd">');
    expect(out).toContain('Write the test first.');
    expect(out).not.toContain('did not fit');
  });

  it('overflows skills that exceed the remaining budget to a name/description list', () => {
    const out = renderInjectedSkillContent({
      skills: [
        { name: 'small', description: 'd1', skillMarkdown: 'tiny body' },
        { name: 'huge', description: 'd2', skillMarkdown: 'word '.repeat(500) },
      ],
      budgetTokens: 5,
      countTokens: wordCount,
    });
    expect(out).toContain('<skill name="small">');
    expect(out).not.toContain('<skill name="huge">');
    expect(out).toContain('- huge — d2');
  });

  it('preserves assignment order in the inlined blocks', () => {
    const out = renderInjectedSkillContent({
      skills: [
        { name: 'a', description: 'da', skillMarkdown: 'A' },
        { name: 'b', description: 'db', skillMarkdown: 'B' },
      ],
      budgetTokens: 1000,
      countTokens: wordCount,
    });
    expect(out.indexOf('name="a"')).toBeLessThan(out.indexOf('name="b"'));
  });
});
