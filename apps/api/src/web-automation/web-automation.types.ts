import type {
  BrowserAutomationActionType,
  BrowserAutomationSelectorSource,
  BrowserAutomationWaitState,
  IBrowserAutomationActionRequest,
  IBrowserAutomationAttemptTrace,
  IBrowserAutomationPolicy,
  IBrowserSelectorTrace,
} from '@nexus/core';

export type BrowserAutomationLoadState = Extract<
  BrowserAutomationWaitState,
  'load' | 'domcontentloaded' | 'networkidle'
>;

export type BrowserAutomationSelectorWaitState = Extract<
  BrowserAutomationWaitState,
  'attached' | 'detached' | 'visible' | 'hidden'
>;

export interface BrowserAutomationPage {
  goto(
    url: string,
    options: { timeout: number; waitUntil: BrowserAutomationLoadState },
  ): Promise<void>;
  click(selector: string, options: { timeout: number }): Promise<void>;
  fill(
    selector: string,
    text: string,
    options: { timeout: number },
  ): Promise<void>;
  waitForSelector(
    selector: string,
    options: { timeout: number; state: BrowserAutomationSelectorWaitState },
  ): Promise<void>;
  waitForLoadState(
    state: BrowserAutomationLoadState,
    options: { timeout: number },
  ): Promise<void>;
  waitForTimeout(durationMs: number): Promise<void>;
  content(): Promise<string>;
  title(): Promise<string>;
  url(): string;
  screenshot(options: { fullPage: boolean; type: 'png' }): Promise<Buffer>;
}

export interface BrowserAutomationSession {
  id: string;
  page: BrowserAutomationPage;
  close(): Promise<void>;
}

export interface BrowserAutomationDriver {
  createSession(sessionId: string): Promise<BrowserAutomationSession>;
}

export interface BrowserAutomationResolvedRequest extends IBrowserAutomationActionRequest {
  action: BrowserAutomationActionType;
  session_id: string;
}

export interface BrowserAutomationActionSuccess {
  ok: true;
  action: BrowserAutomationActionType;
  session_id: string;
  attempts: IBrowserAutomationAttemptTrace[];
  selector_trace?: IBrowserSelectorTrace;
  current_url?: string;
  title?: string;
  html?: string;
  screenshot_base64?: string;
  selector?: string;
  selector_source?: BrowserAutomationSelectorSource;
  waited_for?: string;
}

export type BrowserAutomationSuccessDetails = Omit<
  BrowserAutomationActionSuccess,
  'ok' | 'action' | 'session_id' | 'attempts'
>;

export interface BrowserAutomationActionFailure {
  ok: false;
  action: BrowserAutomationActionType;
  session_id: string;
  error: string;
  failure_artifact_id?: string;
  attempts: IBrowserAutomationAttemptTrace[];
  selector_trace?: IBrowserSelectorTrace;
}

export type BrowserAutomationActionOutcome =
  | BrowserAutomationActionSuccess
  | BrowserAutomationActionFailure;

export type BrowserAutomationExecutionInputs =
  | IBrowserAutomationActionRequest
  | Record<string, unknown>;

export interface BrowserAutomationExecutionContext {
  workflowRunId: string;
  stepId: string;
  inputs: BrowserAutomationExecutionInputs;
}

export interface BrowserAutomationPolicyResolution {
  action: BrowserAutomationActionType;
  policy: IBrowserAutomationPolicy;
}

export type BrowserAutomationAliasMap = Record<string, string[]>;
