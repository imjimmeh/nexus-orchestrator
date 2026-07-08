import { describe, expect, it } from 'vitest';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { classifyTemplateNoise } from './template-noise.classifier';

function buildCandidate(
  overrides: Partial<Pick<LearningCandidate, 'title' | 'summary'>>,
): Pick<LearningCandidate, 'title' | 'summary'> {
  return {
    title: 'Default title',
    summary: 'Default summary',
    ...overrides,
  };
}

describe('classifyTemplateNoise — isTemplate', () => {
  it('flags the recurring-failures template in summary', () => {
    const candidate = buildCandidate({
      summary: 'Recurring auth failures (12 occurrences in 7 days)',
    });
    expect(classifyTemplateNoise(candidate).isTemplate).toBe(true);
  });

  it('flags the recurring-failures template with a multi-word failure type', () => {
    const candidate = buildCandidate({
      summary:
        'Recurring workflow step timeout failures (3 occurrences in 30 days)',
    });
    expect(classifyTemplateNoise(candidate).isTemplate).toBe(true);
  });

  it('flags the workflow-completed-cleanly template in summary', () => {
    const candidate = buildCandidate({
      summary:
        'Workflow run 550e8400-e29b-41d4-a716-446655440000 for scope project-abc completed cleanly in 42s',
    });
    expect(classifyTemplateNoise(candidate).isTemplate).toBe(true);
  });

  it('flags the recurring-failures template in title', () => {
    const candidate = buildCandidate({
      title: 'Recurring database failures (5 occurrences in 14 days)',
      summary: 'Some unrelated summary text.',
    });
    expect(classifyTemplateNoise(candidate).isTemplate).toBe(true);
  });

  it('flags the workflow-completed-cleanly template in title', () => {
    const candidate = buildCandidate({
      title:
        'Workflow run 550e8400-e29b-41d4-a716-446655440000 for scope project-abc completed cleanly in 99s',
      summary: 'Some unrelated summary text.',
    });
    expect(classifyTemplateNoise(candidate).isTemplate).toBe(true);
  });

  it('classifies the orchestration-cycle template as low-signal noise', () => {
    const r = classifyTemplateNoise({
      title: 'Project proj-1 completed an orchestration cycle',
      summary:
        'Project proj-1 completed an orchestration cycle with 2 done items, 0 blocked items, and cycle decision repeat.',
    });
    expect(r.isTemplate).toBe(true);
    expect(r.isLowSignal).toBe(true);
  });

  it('classifies the real production orchestration-cycle lesson as a template', () => {
    const r = classifyTemplateNoise({
      title: 'Default title',
      summary:
        'External project 458935f0-213e-4bbe-89d1-8883e0efa9ad completed an orchestration cycle with 5 done items, 2 blocked items, and cycle decision complete.',
    });
    expect(r.isTemplate).toBe(true);
    expect(r.isLowSignal).toBe(true);
  });

  it('does not flag a lesson that merely mentions recurring but has no template shape', () => {
    const candidate = buildCandidate({
      summary: 'Agent should add retry logic to avoid recurring timeouts.',
    });
    expect(classifyTemplateNoise(candidate).isTemplate).toBe(false);
  });

  it('does not flag a genuine workflow lesson as a template', () => {
    const candidate = buildCandidate({
      summary:
        'When a workflow run succeeds, always verify the output contract fields are populated.',
    });
    expect(classifyTemplateNoise(candidate).isTemplate).toBe(false);
  });
});

describe('classifyTemplateNoise — isLowSignal', () => {
  it('flags a lesson with no concrete anchor as low-signal', () => {
    const candidate = buildCandidate({
      summary: 'Things went well overall.',
    });
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(true);
  });

  it('does not flag a lesson containing a file path as low-signal', () => {
    const candidate = buildCandidate({
      summary:
        'Edit apps/api/src/memory/signals/template-noise.classifier.ts to add the new pattern.',
    });
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(false);
  });

  it('does not flag a lesson containing a tool name as low-signal', () => {
    const candidate = buildCandidate({
      summary:
        'Use list_pending_learning_candidates before promoting any candidate.',
    });
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(false);
  });

  it('does not flag a lesson containing a command as low-signal', () => {
    const candidate = buildCandidate({
      summary:
        'Run npm run build:api before deploying to verify there are no TypeScript errors.',
    });
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(false);
  });

  it('does not flag a lesson containing a database table as low-signal', () => {
    const candidate = buildCandidate({
      summary: 'The learning_candidates table is queried by the sweep agent.',
    });
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(false);
  });

  it('does not flag a lesson containing a credential reference as low-signal', () => {
    const candidate = buildCandidate({
      summary:
        'Store the API_KEY in the secret_store, never in environment variables.',
    });
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(false);
  });

  it('does not flag a lesson containing an imperative verb as low-signal', () => {
    const candidate = buildCandidate({
      summary:
        'Always verify the output contract after the agent completes its step.',
    });
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(false);
  });

  it('considers both title and summary for low-signal detection', () => {
    const candidate = buildCandidate({
      title: 'Update the retry policy',
      summary: 'Something went wrong.',
    });
    // Title contains an imperative verb "Update" — not low signal
    expect(classifyTemplateNoise(candidate).isLowSignal).toBe(false);
  });
});

describe('classifyTemplateNoise — template rows are independently low-signal', () => {
  it('a template-classified row also sets isLowSignal true', () => {
    const candidate = buildCandidate({
      summary: 'Recurring auth failures (12 occurrences in 7 days)',
    });
    const result = classifyTemplateNoise(candidate);
    expect(result.isTemplate).toBe(true);
    expect(result.isLowSignal).toBe(true);
  });
});
