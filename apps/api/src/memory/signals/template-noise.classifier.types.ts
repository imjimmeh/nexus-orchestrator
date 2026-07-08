/** The classification result returned by {@link classifyTemplateNoise}. */
export interface TemplateNoiseClassification {
  /**
   * `true` when the candidate's text matches a known content-free templated
   * learning-candidate shape that carries no actionable lesson.
   *
   * Template rows are NOT deleted; they are excluded from the sweep queue so
   * they can still accumulate recurrence_count for future scoring.
   */
  isTemplate: boolean;

  /**
   * `true` when the candidate's text contains no concrete anchor
   * (file path, table name, tool name, shell command, credential, or
   * imperative verb) that a future agent could act on.
   *
   * Template-classified rows are always considered low-signal.
   */
  isLowSignal: boolean;
}
