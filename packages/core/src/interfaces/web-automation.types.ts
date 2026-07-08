export const BROWSER_AUTOMATION_ACTION_TYPES = [
  "open_page",
  "navigate",
  "click",
  "type",
  "wait_for",
  "read_page",
  "screenshot",
] as const;

export type BrowserAutomationActionType =
  (typeof BROWSER_AUTOMATION_ACTION_TYPES)[number];

export type BrowserAutomationWaitState =
  | "load"
  | "domcontentloaded"
  | "networkidle"
  | "attached"
  | "detached"
  | "visible"
  | "hidden";

export type BrowserAutomationLoadState = Extract<
  BrowserAutomationWaitState,
  "load" | "domcontentloaded" | "networkidle"
>;

export type BrowserAutomationSelectorWaitState = Extract<
  BrowserAutomationWaitState,
  "attached" | "detached" | "visible" | "hidden"
>;

export type BrowserAutomationSelectorSource =
  | "explicit"
  | "alias"
  | "heuristic";

export interface IBrowserSelectorCandidate {
  selector: string;
  source: BrowserAutomationSelectorSource;
  reason: string;
  rank: number;
}

export interface IBrowserSelectorTrace {
  alias?: string;
  candidates: IBrowserSelectorCandidate[];
  attempted_selectors: string[];
  selected_selector?: string | null;
  selected_source?: BrowserAutomationSelectorSource | null;
}

export interface IBrowserAutomationPolicy {
  timeout_ms: number;
  retry_budget: number;
  backoff_initial_ms: number;
  backoff_factor: number;
  backoff_max_ms: number;
  pacing_ms: number;
}

export interface IBrowserAutomationActionRequest {
  action: BrowserAutomationActionType;
  session_id?: string;
  url?: string;
  text?: string;
  selector?: string;
  selector_alias?: string;
  selector_aliases?: Record<string, string | string[]>;
  role?: string;
  name?: string;
  target_text?: string;
  placeholder?: string;
  test_id?: string;
  wait_for?: BrowserAutomationWaitState;
  wait_state?: BrowserAutomationWaitState;
  duration_ms?: number;
  full_page?: boolean;
  policy?: Partial<IBrowserAutomationPolicy>;
  timeout_ms?: number;
  retry_budget?: number;
  backoff_initial_ms?: number;
  backoff_factor?: number;
  backoff_max_ms?: number;
  pacing_ms?: number;
}

export interface IBrowserAutomationAttemptTrace {
  attempt: number;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  success: boolean;
  selector?: string | null;
  selector_source?: BrowserAutomationSelectorSource | null;
  error_message?: string | null;
}

export interface IWebAutomationFailureArtifact {
  id: string;
  workflow_run_id: string;
  step_id: string;
  action_name: BrowserAutomationActionType;
  action_payload: IBrowserAutomationActionRequest | Record<string, unknown>;
  selector_trace?: IBrowserSelectorTrace | null;
  attempts: IBrowserAutomationAttemptTrace[];
  attempt_count: number;
  duration_ms: number;
  error_message: string;
  dom_snapshot_hash?: string | null;
  dom_snapshot?: string | null;
  screenshot_base64?: string | null;
  created_at: Date;
  updated_at: Date;
}
