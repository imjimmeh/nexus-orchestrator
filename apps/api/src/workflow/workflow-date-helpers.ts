type HelperHost = {
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;
};

/**
 * Registers date/time template helpers on a Handlebars instance.
 *
 * `now` returns the current time as an ISO-8601 UTC string, e.g.
 * `2026-06-19T03:00:00.000Z`. It is intentionally NON-DETERMINISTIC and must
 * not be used in step `condition`s or anywhere workflow diffing/dry-run assumes
 * a stable render — it is for injecting timestamps into prompt/file content
 * only. Handlebars passes its `options` object as the trailing argument, which
 * the zero-arg implementation ignores naturally.
 */
export function registerDateHelpers(hbs: HelperHost): void {
  hbs.registerHelper('now', () => new Date().toISOString());
}
