import { describe, expect, it } from "vitest";
import { WorkflowRun, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { buildWorkflowRunRuntimeNotice } from "./workflowRunPresentation.helpers";

function workflowRun(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "run-1",
    workflow_id: "workflow-1",
    status: "RUNNING",
    current_step_id: null,
    state_variables: {},
    created_at: "2026-05-30T19:00:00.000Z",
    updated_at: "2026-05-30T19:00:00.000Z",
    ...overrides,
  };
}

function event(
  event_type: string,
  timestamp: string,
  payload: Record<string, unknown>,
): WorkflowTelemetryEvent {
  return { event_type, timestamp, payload };
}

describe("buildWorkflowRunRuntimeNotice", () => {
  it("derives a provider retry notice from b85-style auto retry state", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        current_step_id: "ceo_orchestration_decision",
        state_variables: {
          _internal: {
            auto_retry: {
              ceo_orchestration_decision: {
                attempt: 2,
                last_failure: {
                  reason: "Provider rate limit exceeded",
                  message: "Provider rate limit exceeded",
                  reasonCode: "provider_rate_limit_429",
                  nextRetryAt: "2026-05-30T20:01:00.000Z",
                  resetAt: "2026-05-30T20:00:00.000Z",
                  providerTier: "Token Plan Plus",
                  usageLimit: { used: 4500, limit: 4500, unit: "tokens" },
                  retryQueueJobId:
                    "auto-retry-run-1-ceo_orchestration_decision",
                },
              },
            },
          },
        },
      }),
      events: [
        event("workflow.retry_scheduled", "2026-05-30T19:59:00.000Z", {
          jobId: "ceo_orchestration_decision",
          attempt: 2,
          maxAttempts: 4,
        }),
      ],
    });

    expect(notice?.kind).toBe("provider_rate_limit_retry");
    expect(notice?.title).toBe("Provider rate limit retry scheduled");
    expect(notice?.isWaitingOnRetry).toBe(true);
    expect(notice?.retryMetadata).toMatchObject({
      jobId: "ceo_orchestration_decision",
      attempt: 2,
      maxAttempts: 4,
      nextRetryAt: "2026-05-30T20:01:00.000Z",
      rateLimitResetAt: "2026-05-30T20:00:00.000Z",
      providerTier: "Token Plan Plus",
      usageLimit: { used: 4500, limit: 4500 },
    });
  });

  it("derives an error notice from a generic failed event", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({ status: "FAILED" }),
      events: [
        event("workflow.turn.completed", "2026-05-30T20:02:00.000Z", {
          jobId: "decide",
          outcome: "failure",
          errorMessage: "Model returned invalid JSON",
        }),
      ],
    });

    expect(notice).toMatchObject({
      kind: "error",
      title: "Workflow error",
      message: "Model returned invalid JSON",
      isWaitingOnRetry: false,
    });
    expect(notice?.errorSummary).toMatchObject({
      jobId: "decide",
      eventType: "workflow.turn.completed",
    });
  });

  it("returns no notice when there is no retry or error", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({ status: "COMPLETED" }),
      events: [
        event("workflow.turn.completed", "2026-05-30T20:02:00.000Z", {
          outcome: "success",
        }),
      ],
    });

    expect(notice).toBeNull();
  });

  it("derives an error notice from state output when events omit failure", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        status: "COMPLETED",
        updated_at: "2026-05-30T20:03:00.000Z",
        state_variables: {
          jobs: {
            attempt_merge: {
              output: {
                ok: false,
                merge_message:
                  "Command failed: git merge --no-ff --no-edit feature/x",
              },
            },
          },
        },
      }),
      events: [
        event("workflow.completed", "2026-05-30T20:03:00.000Z", {
          status: "COMPLETED",
        }),
      ],
    });

    expect(notice).toMatchObject({
      kind: "error",
      title: "Workflow error",
      message: "Command failed: git merge --no-ff --no-edit feature/x",
      isWaitingOnRetry: false,
    });
    expect(notice?.errorSummary).toMatchObject({
      eventType: "workflow.state.output",
      jobId: "attempt_merge",
      occurredAt: "2026-05-30T20:03:00.000Z",
    });
  });

  it("picks the current job retry before newer retry entries", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        current_step_id: "active_job",
        state_variables: {
          _internal: {
            auto_retry: {
              older_job: {
                last_failure: {
                  reasonCode: "generic_failure",
                  nextRetryAt: "2026-05-30T20:10:00.000Z",
                },
              },
              active_job: {
                last_failure: {
                  reasonCode: "generic_failure",
                  nextRetryAt: "2026-05-30T20:05:00.000Z",
                },
              },
            },
          },
        },
      }),
      events: [],
    });

    expect(notice?.retryMetadata?.jobId).toBe("active_job");
    expect(notice?.retryMetadata?.nextRetryAt).toBe("2026-05-30T20:05:00.000Z");
  });

  it("does not show a retry notice once the retry activated and only the attempt budget remains", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        current_step_id: "run_scope_probes",
        state_variables: {
          _internal: {
            auto_retry: {
              // last_failure has been cleared by the server on activation;
              // only the retry-budget accounting remains.
              run_scope_probes: {
                attempt: 1,
                first_failure_at: "2026-05-30T20:00:00.000Z",
              },
            },
          },
        },
      }),
      events: [
        event("workflow.retry_scheduled", "2026-05-30T20:00:30.000Z", {
          jobId: "run_scope_probes",
          attempt: 1,
          maxAttempts: 4,
          nextRetryAt: "2026-05-30T20:01:30.000Z",
        }),
      ],
    });

    expect(notice?.isWaitingOnRetry ?? false).toBe(false);
  });

  it("does not resurrect a retry notice from historical events when no auto_retry state remains", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        current_step_id: "finalize",
        state_variables: {},
      }),
      events: [
        event("workflow.retry_scheduled", "2026-05-30T20:00:30.000Z", {
          jobId: "run_scope_probes",
          attempt: 1,
          maxAttempts: 4,
          nextRetryAt: "2026-05-30T20:01:30.000Z",
        }),
      ],
    });

    expect(notice).toBeNull();
  });

  it("does not show a retry notice for a terminal run that still holds auto_retry state", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        status: "FAILED",
        current_step_id: "run_scope_probes",
        state_variables: {
          _internal: {
            auto_retry: {
              run_scope_probes: {
                attempt: 3,
                last_failure: {
                  reasonCode: "generic_failure",
                  nextRetryAt: "2026-05-30T20:01:30.000Z",
                  retryQueueJobId: "auto-retry-run-1-run_scope_probes",
                },
              },
            },
          },
        },
      }),
      events: [],
    });

    expect(notice?.isWaitingOnRetry ?? false).toBe(false);
  });

  it("does not treat a condition-skipped job as a workflow error", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        status: "COMPLETED",
        updated_at: "2026-05-30T20:03:00.000Z",
        state_variables: {
          jobs: {
            delta_replan: {
              output: {
                skipped: true,
                reason: "condition_false",
              },
            },
          },
        },
      }),
      events: [
        event("workflow.completed", "2026-05-30T20:03:00.000Z", {
          status: "COMPLETED",
        }),
      ],
    });

    expect(notice).toBeNull();
  });

  it("does not treat a controlled-termination agent_end as a workflow error", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({ status: "COMPLETED" }),
      events: [
        event("agent_end", "2026-07-08T11:19:30.000Z", {
          stopReason: "aborted",
          errorMessage: "Request was aborted.",
          output: { ok: true, response: "All milestones implemented." },
        }),
      ],
    });

    expect(notice).toBeNull();
  });

  it("does not treat a subagent failure event as a run-level workflow error", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({ status: "COMPLETED" }),
      events: [
        event("agent_end", "2026-07-08T11:10:46.000Z", {
          stopReason: "error",
          outcome: "failure",
          errorMessage: "Provider finish_reason: abort",
          subagentExecutionId: "bd1725a5-8b16-4837-afed-5fcbe81a16fb",
          isSubagent: true,
          output: { ok: false, errorMessage: "Provider finish_reason: abort" },
        }),
        event("workflow.agent.completed", "2026-07-08T11:19:30.000Z", {
          outcome: "success",
          stepId: "implement",
        }),
      ],
    });

    expect(notice).toBeNull();
  });

  it("still surfaces a real parent agent failure", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({ status: "FAILED" }),
      events: [
        event("agent_end", "2026-07-08T11:10:46.000Z", {
          stopReason: "error",
          outcome: "failure",
          errorMessage: "Provider finish_reason: abort",
          output: { ok: false },
        }),
      ],
    });

    expect(notice).toMatchObject({
      kind: "error",
      message: "Provider finish_reason: abort",
    });
  });

  it("still surfaces a real failure even when a sibling job was skipped", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        status: "FAILED",
        updated_at: "2026-05-30T20:03:00.000Z",
        state_variables: {
          jobs: {
            delta_replan: {
              output: {
                skipped: true,
                reason: "condition_false",
              },
            },
            attempt_merge: {
              output: {
                ok: false,
                merge_message: "Command failed: git merge --no-ff",
              },
            },
          },
        },
      }),
      events: [],
    });

    expect(notice).toMatchObject({
      kind: "error",
      title: "Workflow error",
      message: "Command failed: git merge --no-ff",
    });
    expect(notice?.errorSummary?.jobId).toBe("attempt_merge");
  });

  it("picks the latest retry time when no current job matches", () => {
    const notice = buildWorkflowRunRuntimeNotice({
      workflowRun: workflowRun({
        current_step_id: "other_job",
        state_variables: {
          _internal: {
            auto_retry: {
              earlier_job: {
                last_failure: {
                  reasonCode: "generic_failure",
                  nextRetryAt: "2026-05-30T20:05:00.000Z",
                },
              },
              latest_job: {
                last_failure: {
                  reasonCode: "generic_failure",
                  nextRetryAt: "2026-05-30T20:10:00.000Z",
                },
              },
            },
          },
        },
      }),
      events: [],
    });

    expect(notice?.retryMetadata?.jobId).toBe("latest_job");
  });
});
