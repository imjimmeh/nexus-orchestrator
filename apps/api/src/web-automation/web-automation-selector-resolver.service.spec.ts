import { describe, expect, it } from 'vitest';
import { WebAutomationSelectorResolverService } from './web-automation-selector-resolver.service';

describe('WebAutomationSelectorResolverService', () => {
  it('combines explicit, alias, and heuristic selector candidates in priority order', () => {
    const service = new WebAutomationSelectorResolverService();

    const trace = service.resolve({
      action: 'click',
      session_id: 'default',
      selector: '#explicit',
      selector_alias: 'primary_button',
      target_text: 'Save',
      test_id: 'save-btn',
    });

    expect(trace.candidates[0]?.selector).toBe('#explicit');
    expect(trace.candidates[0]?.source).toBe('explicit');
    expect(
      trace.candidates.some((candidate) => candidate.source === 'alias'),
    ).toBe(true);
    expect(
      trace.candidates.some((candidate) =>
        candidate.reason.includes('target_text'),
      ),
    ).toBe(true);
    expect(
      trace.candidates.some((candidate) =>
        candidate.selector.includes('[data-testid="save-btn"]'),
      ),
    ).toBe(true);
  });
});
