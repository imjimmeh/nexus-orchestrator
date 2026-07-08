import { z } from 'zod';

/**
 * Window selector for the self-improvement control plane's
 * `PromotedLessonsCard` + `SkillBindingUsageCard`. The string is a
 * compact `<count><unit>` token where `unit` is one of:
 *   - `d` — calendar days
 *   - `h` — hours
 *   - `m` — minutes
 *
 * Mirrors the existing `since` query parameter shape used by the
 * runtime-feedback diagnostics surface so operators do not need to
 * learn a second vocabulary. Default is `7d` so the control plane
 * renders the trailing week's activity on a cold visit.
 */
const SINCE_TOKEN_PATTERN = /^\d+[dhm]$/;

const sinceTokenSchema = z
  .string()
  .regex(SINCE_TOKEN_PATTERN, {
    message:
      "'since' must be a positive integer followed by d (days), h (hours), or m (minutes)",
  })
  .default('7d')
  .transform((value, ctx) => {
    const unit = value.charAt(value.length - 1);
    const amount = Number(value.slice(0, -1));
    if (!Number.isFinite(amount) || amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'since' must be a positive integer",
      });
      return z.NEVER;
    }
    const unitMs =
      unit === 'd'
        ? 24 * 60 * 60 * 1000
        : unit === 'h'
          ? 60 * 60 * 1000
          : 60 * 1000;
    return new Date(Date.now() - amount * unitMs);
  });

/**
 * Query schema for `GET /self-improvement/promoted-lessons`. The
 * `since` parameter is the only knob — control-plane surface area
 * is intentionally small. The transformed value is a `Date`
 * representing `now - N units`; the service treats it as the lower
 * bound of the listing window.
 */
export const promotedLessonsQuerySchema = z
  .object({
    since: sinceTokenSchema.optional(),
  })
  .strict();

export type PromotedLessonsQuery = z.infer<typeof promotedLessonsQuerySchema>;

/**
 * Compact shape for the `promoted` array on the
 * `PromotedLessonsCard`. `id` is the promoted memory segment's UUID;
 * `sourceSignalId` is the runtime-feedback signal group that drove
 * the lesson (or `null` when no group has been correlated — the
 * promotion writer may have promoted the candidate without
 * recording a signal pointer, e.g. a `learned_capability` route).
 */
export interface PromotedLesson {
  id: string;
  sourceSignalId: string | null;
  promotedAt: string;
  confidence: number;
  workflowSkillBindingIds: string[];
}

/**
 * Compact shape for the `bindings` array on the
 * `SkillBindingUsageCard`. `mostSpecificSource` is the binding's
 * binding-scope (workflow or step) — profile-scope is intentionally
 * NOT a valid value because `workflow_skill_bindings` does not
 * represent profile-scope assignments. Profile assignments live on
 * the agent profile / skill binding table (see
 * `effective-skills.types.ts` for the full source taxonomy).
 */
export interface SkillBindingUsage {
  id: string;
  mostSpecificSource: 'workflow' | 'step';
  reuseCount7d: number;
  workflowStepIds: string[];
}

export interface PromotedLessonsResponse {
  promoted: PromotedLesson[];
  bindings: SkillBindingUsage[];
}
