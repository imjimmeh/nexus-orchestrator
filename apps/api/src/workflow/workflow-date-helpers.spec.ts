import { describe, it, expect } from 'vitest';
import { StateManagerService } from './state-manager.service';

describe('now handlebars helper', () => {
  it('renders the current time as an ISO-8601 UTC string via substituteTemplate', () => {
    const svc = new StateManagerService({} as never);

    const rendered = svc.substituteTemplate('{{ now }}', {}).trim();

    expect(rendered).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(rendered))).toBe(false);
  });
});
