import { describe, it, expect } from 'vitest';
import Handlebars from 'handlebars';
import { registerComparisonHelpers } from './workflow-comparison-helpers';

function render(template: string, context: Record<string, unknown>): string {
  const hbs = Handlebars.create();
  registerComparisonHelpers(hbs);
  return hbs.compile(template, { noEscape: true })(context).trim();
}

describe('registerComparisonHelpers', () => {
  it('gte is true when left >= right', () => {
    expect(
      render('{{#if (gte a 10)}}true{{else}}false{{/if}}', { a: 10 }),
    ).toBe('true');
    expect(render('{{#if (gte a 10)}}true{{else}}false{{/if}}', { a: 9 })).toBe(
      'false',
    );
  });

  it('lte is true when left <= right', () => {
    expect(render('{{#if (lte a 2)}}true{{else}}false{{/if}}', { a: 2 })).toBe(
      'true',
    );
    expect(render('{{#if (lte a 2)}}true{{else}}false{{/if}}', { a: 3 })).toBe(
      'false',
    );
  });

  it('gt and lt are strict', () => {
    expect(render('{{#if (gt a 10)}}true{{else}}false{{/if}}', { a: 10 })).toBe(
      'false',
    );
    expect(render('{{#if (lt a 2)}}true{{else}}false{{/if}}', { a: 1 })).toBe(
      'true',
    );
    expect(render('{{#if (gt a 10)}}true{{else}}false{{/if}}', { a: 11 })).toBe(
      'true',
    );
    expect(render('{{#if (lt a 2)}}true{{else}}false{{/if}}', { a: 3 })).toBe(
      'false',
    );
  });

  it('returns false for null / non-numeric operands', () => {
    expect(
      render('{{#if (lte a 2)}}true{{else}}false{{/if}}', { a: null }),
    ).toBe('false');
    expect(
      render('{{#if (gte a 10)}}true{{else}}false{{/if}}', { a: 'x' }),
    ).toBe('false');
  });
});
