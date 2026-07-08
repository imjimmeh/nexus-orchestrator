type HelperHost = {
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;
};

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compare(
  a: unknown,
  b: unknown,
  op: (x: number, y: number) => boolean,
): boolean {
  const x = toFiniteNumber(a);
  const y = toFiniteNumber(b);
  return x !== null && y !== null && op(x, y);
}

/**
 * Registers numeric comparison helpers on a Handlebars instance.
 *
 * Handlebars passes its `options` object as the trailing argument, so the
 * binary `(a, b)` signatures ignore it naturally. Non-numeric, null, undefined
 * or NaN operands yield `false` so a workflow gate never fires on missing data.
 *
 * String operands are NOT coerced — e.g. `(gt "5" 3)` yields `false` even
 * though the string "5" looks numeric. YAML authors must ensure operands are
 * number-typed values, not numeric strings.
 */
export function registerComparisonHelpers(hbs: HelperHost): void {
  hbs.registerHelper('gt', (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x > y),
  );
  hbs.registerHelper('gte', (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x >= y),
  );
  hbs.registerHelper('lt', (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x < y),
  );
  hbs.registerHelper('lte', (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x <= y),
  );
  hbs.registerHelper('bool', (a: unknown) => Boolean(a));
}
