export const RUNTIME_FEEDBACK_CANDIDATE_TYPE = 'runtime_feedback';

export const RUNTIME_FEEDBACK_EVENT_NAMES = {
  signalIngested: 'runtime.feedback.signal_ingested',
  signalSkipped: 'runtime.feedback.signal_skipped',
  candidateCreated: 'runtime.feedback.candidate_created',
} as const;

export type RuntimeFeedbackSkippedReason =
  | 'candidate_exists'
  | 'cooldown_active'
  | 'confidence_below_threshold'
  | 'frequency_below_threshold'
  | 'frequency_window_expired';
