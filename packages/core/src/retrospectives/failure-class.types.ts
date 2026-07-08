/**
 * Classifies workflow / cycle-decision failures so the failure-threshold
 * retrospective trigger can decide which failures count toward its
 * consecutive-failure counter and which are intentional and should be
 * ignored.
 *
 * Defined in `@nexus/core` (a scope/context-neutral shared package) so
 * that the API / core services, consumer apps, and any downstream
 * consumer can reference the same discriminator. The failure-threshold
 * service re-exports the enum for convenience so its call sites do not
 * need a second import path.
 *
 * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062)
 * Closes OPEN_QUESTIONS K1.
 */
export enum FailureClass {
  /**
   * The QA agent rejected the work item's output. The retry is an
   * intentional product decision, not a system regression — do NOT
   * count this toward the failure threshold.
   */
  QaRejection = "qa_rejection",

  /**
   * The orchestration cycle was a no-op because there is no
   * actionable work (status `failed` due to no actionable work).
   * This is an intentional repeat of a healthy cycle decision, not
   * a system regression — do NOT count this toward the failure
   * threshold.
   */
  NoActionableWork = "no_actionable_work",

  /**
   * A container-lost, orchestrator-error, or other infra/system
   * failure caused the workflow run to terminate without a
   * domain-meaningful explanation. This is a real failure and MUST
   * count toward the failure threshold.
   */
  SystemFailure = "system_failure",

  /**
   * A domain event failed to be delivered (e.g. the core event bus
   * rejected the envelope, the projection storage rejected the
   * record, or the underlying transport returned a non-retryable
   * error). This is a real failure and MUST count toward the
   * failure threshold.
   */
  EventDeliveryFailure = "event_delivery_failure",

  /**
   * An unhandled exception bubbled up through the orchestration or
   * retrospective pipeline. This is a real failure and MUST count
   * toward the failure threshold.
   */
  UnhandledException = "unhandled_exception",
}

/**
 * The set of {@link FailureClass} values that increment the
 * consecutive-failure counter. The remaining values (`QaRejection`,
 * `NoActionableWork`) are intentional and do not count.
 */
export const FAILURE_CLASSES_THAT_COUNT: ReadonlySet<FailureClass> = new Set<
  FailureClass
>([
  FailureClass.SystemFailure,
  FailureClass.EventDeliveryFailure,
  FailureClass.UnhandledException,
]);

/**
 * Returns `true` when the given failure class should increment the
 * consecutive-failure counter used by the failure-threshold
 * retrospective trigger.
 *
 * Treats `undefined` as "unknown / not classified" and conservatively
 * counts it (i.e. returns `true`). This keeps the existing behaviour
 * for any caller that has not yet been updated to thread the
 * discriminator through.
 */
export function shouldCountFailure(
  failureClass: FailureClass | undefined,
): boolean {
  if (failureClass === undefined) {
    return true;
  }
  return FAILURE_CLASSES_THAT_COUNT.has(failureClass);
}
