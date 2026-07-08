// packages/e2e-tests/src/scenarios/qa-review.e2e-spec.ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "../driver/api-client.js";
import { KanbanClient } from "../driver/kanban-client.js";
import { buildAdminToken } from "../driver/auth.js";
import { pollUntil } from "../driver/polling.js";
import { readStackContext } from "./setup/stack-context-file.js";
import type { Scenario } from "../fake-llm/index.js";

const ctx = readStackContext();
let api: ApiClient;
let kanban: KanbanClient;

// ── Control-server helpers ────────────────────────────────────────────────────
// The fake LLM server lives in the globalSetup process, not in this test worker.
// We communicate with it via the tiny HTTP control server started by global-setup.ts.

const CONTROL_BASE = `http://127.0.0.1:${ctx.fakeLlmControlPort}`;

async function loadScenario(scenarioObj: Scenario): Promise<void> {
  const response = await fetch(`${CONTROL_BASE}/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenarioObj),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to load scenario into fake LLM: ${response.status} ${text}`,
    );
  }
}

async function resetFakeLlm(): Promise<void> {
  const response = await fetch(`${CONTROL_BASE}/reset`, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to reset fake LLM: ${response.status} ${text}`);
  }
}

// ── Workflow / work-item polling helpers ──────────────────────────────────────

async function waitForWorkflowTriggeredByWorkItem(
  workItemId: string,
  timeoutMs = 30_000,
): Promise<{ id: string; status: string }> {
  return pollUntil(
    async () => {
      const list = await api.get<{
        success: boolean;
        data: Array<{ id: string; status: string }>;
      }>(`/workflows/runs?contextId=${workItemId}&limit=5`);
      return list.data[0] ?? null;
    },
    (r): r is { id: string; status: string } => r !== null,
    {
      timeoutMs,
      intervalMs: 2_000,
      label: `workflow run for work item ${workItemId}`,
    },
  );
}

async function waitForRunFinalStatus(
  runId: string,
  timeoutMs = 180_000,
): Promise<string> {
  const final = await pollUntil(
    async () => {
      const r = await api.get<{
        success: boolean;
        data: { id: string; status: string };
      }>(`/workflows/runs/${runId}`);
      return r.data;
    },
    (r) => r.status === "COMPLETED" || r.status === "FAILED",
    { timeoutMs, intervalMs: 3_000, label: `run ${runId} final status` },
  );
  return final.status;
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeAll(() => {
  const token = buildAdminToken(ctx.jwtSecret);
  api = new ApiClient({ baseUrl: `${ctx.apiHttp}/api`, token });
  kanban = new KanbanClient(ctx.kanbanHttp, token);
});

afterEach(async () => {
  await resetFakeLlm();
});

// ── Scenarios ─────────────────────────────────────────────────────────────────

/**
 * Scenario that causes the in-review workflow to accept the code review.
 *
 * The in-review workflow sends a completion request to the LLM expecting it to
 * call `set_job_output` with `{ decision: "accept" }`. We script exactly that
 * response so the workflow auto-transitions the work item to ready-to-merge.
 */
const acceptScenario: Scenario = {
  name: "qa-review-accept",
  rules: [
    {
      match: { hasTool: "set_job_output" },
      respond: [
        {
          kind: "tool_call",
          toolName: "set_job_output",
          arguments: { decision: "accept", summary: "e2e: code review passed" },
        },
      ],
    },
    // Catch-all fallback so any subsequent turn (e.g. tool-result acknowledgement)
    // gets a benign text response rather than the unmatched sentinel.
    {
      match: {},
      respond: [{ kind: "text", text: "Done." }],
    },
  ],
};

/**
 * Scenario that causes the in-review workflow to reject the code review.
 *
 * We return `decision: "reject"` which tells the workflow to revert the work
 * item rather than promoting it to ready-to-merge.
 */
const rejectScenario: Scenario = {
  name: "qa-review-reject",
  rules: [
    {
      match: { hasTool: "set_job_output" },
      respond: [
        {
          kind: "tool_call",
          toolName: "set_job_output",
          arguments: {
            decision: "reject",
            summary: "e2e: code review failed — needs rework",
          },
        },
      ],
    },
    {
      match: {},
      respond: [{ kind: "text", text: "Rejected." }],
    },
  ],
};

// ── Test suites ───────────────────────────────────────────────────────────────

describe("QA review: accept path", () => {
  beforeEach(async () => {
    await loadScenario(acceptScenario);
  });

  it("transitions work item to ready-to-merge when LLM accepts", async () => {
    const project = await kanban.createProject(
      `qa-review-accept-${Date.now()}`,
    );
    const workItem = await kanban.createWorkItem(
      project.id,
      "e2e: qa review accept",
    );

    // Trigger: move to in-review fires the Kanban event → API dispatches workflow
    await kanban.transitionWorkItem(project.id, workItem.id, "in-review");

    // Wait for the workflow run to appear in the API
    const run = await waitForWorkflowTriggeredByWorkItem(workItem.id);

    // Wait for the run to reach a terminal status
    const status = await waitForRunFinalStatus(run.id);
    expect(status).toBe("COMPLETED");

    // The workflow's set_job_output(accept) should have triggered the work item
    // transition to ready-to-merge via the Kanban service callback.
    const finalItem = await kanban.getWorkItem(project.id, workItem.id);
    expect(finalItem.status).toBe("ready-to-merge");
  }, 240_000);
});

describe("QA review: reject path", () => {
  beforeEach(async () => {
    await loadScenario(rejectScenario);
  });

  it("keeps work item out of ready-to-merge when LLM rejects", async () => {
    const project = await kanban.createProject(
      `qa-review-reject-${Date.now()}`,
    );
    const workItem = await kanban.createWorkItem(
      project.id,
      "e2e: qa review reject",
    );

    await kanban.transitionWorkItem(project.id, workItem.id, "in-review");
    const run = await waitForWorkflowTriggeredByWorkItem(workItem.id);
    const status = await waitForRunFinalStatus(run.id);

    // The workflow should have completed (the reject path is a valid workflow
    // completion, not a failure), but the work item must NOT be ready-to-merge.
    // Acceptable post-reject statuses depend on the workflow's revert logic.
    expect(["COMPLETED", "FAILED"]).toContain(status);

    const finalItem = await kanban.getWorkItem(project.id, workItem.id);
    expect(finalItem.status).not.toBe("ready-to-merge");
    expect(["in-review", "in-progress", "rejected"]).toContain(
      finalItem.status,
    );
  }, 240_000);
});
