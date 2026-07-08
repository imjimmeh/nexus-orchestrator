import Handlebars from 'handlebars';
import { registerComparisonHelpers } from './workflow-comparison-helpers';

const hbs = Handlebars.create();
hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
hbs.registerHelper('and', (...args: unknown[]) => {
  const values = args.slice(0, -1);
  if (values.length === 0) {
    return false;
  }
  return values.every((value) => Boolean(value));
});
hbs.registerHelper('or', (...args: unknown[]) => {
  const values = args.slice(0, -1);
  return values.some((value) => Boolean(value));
});
hbs.registerHelper('not', (value: unknown) => !value);
registerComparisonHelpers(hbs);

/**
 * Evaluate a Handlebars trigger condition against an event payload.
 *
 * - Returns true when the condition is missing or whitespace-only
 *   (treated as "always trigger").
 * - Returns true when the rendered condition equals the literal string "true".
 * - Returns false for any other rendered output, including malformed
 *   templates (error swallowed so trigger resolution never crashes).
 *
 * The payload is exposed to the template both at the root level and under a
 * `trigger.*` namespace, matching how trigger data is referenced from
 * workflow step templates (e.g. `{{ trigger.resource.scope }}`).
 *
 * The strict "true" contract mirrors the existing workflow step-condition
 * convention used by `StepExecutionOrchestratorService.evaluateCondition`.
 */
export function evaluateTriggerCondition(
  condition: string | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!condition || condition.trim().length === 0) {
    return true;
  }

  try {
    const compiled = hbs.compile(condition, { noEscape: true });
    const rendered = compiled({ ...payload, trigger: payload });
    return rendered.trim() === 'true';
  } catch {
    return false;
  }
}
