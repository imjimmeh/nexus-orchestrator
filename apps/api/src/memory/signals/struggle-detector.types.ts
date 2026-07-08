/** A single failed tool-call captured as part of a struggle span. */
export interface FailedAttempt {
  errorCode?: string;
  errorMessage?: string;
  payload?: Record<string, unknown>;
}

/** A recovering tool call that broke the failure streak. */
export interface RecoveringCall {
  payload?: Record<string, unknown>;
}

/**
 * One struggle span: a sequence of ≥2 failures on the same tool followed
 * by a success.  Carries the evidence needed to craft a learning candidate.
 */
export interface StruggleSpan {
  tool: string;
  failedAttempts: FailedAttempt[];
  recoveringCall: RecoveringCall;
  errorCodes: string[];
}
