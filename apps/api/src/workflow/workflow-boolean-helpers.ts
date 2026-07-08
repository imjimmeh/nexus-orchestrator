type HelperHost = {
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;
};

/**
 * Coerces a value that is semantically a boolean into a real boolean.
 *
 * Agent-emitted structured output (`set_job_output`) often arrives with
 * booleans serialized as the strings `"true"` / `"false"` depending on the
 * provider/harness. Raw Handlebars `{{#if x}}` treats the non-empty string
 * `"false"` as truthy, which silently inverts workflow gates. Routing such
 * values through `coerceBoolean` makes `"false"` behave as `false`.
 *
 * Real booleans pass through unchanged. The strings `"true"`/`"false"` are
 * matched case-insensitively after trimming. Empty strings, `null` and
 * `undefined` are `false`. Any other value falls back to JS truthiness so a
 * gate never fires on missing data.
 */
export function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false' || normalized === '') {
      return false;
    }
  }
  return Boolean(value);
}

/**
 * Registers the `bool` coercion helper on a Handlebars instance. Handlebars
 * passes its `options` object as the trailing argument, so the unary signature
 * ignores it naturally.
 */
export function registerBooleanHelpers(hbs: HelperHost): void {
  hbs.registerHelper('bool', (value: unknown) => coerceBoolean(value));
}
