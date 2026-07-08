// packages/e2e-tests/src/scenarios/kanban-lifecycle.e2e-spec.ts
import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../driver/api-client.js";
import { KanbanClient } from "../driver/kanban-client.js";
import { buildAdminToken } from "../driver/auth.js";
import { pollUntil } from "../driver/polling.js";
import { readStackContext } from "./setup/stack-context-file.js";

const ctx = readStackContext();
let api: ApiClient;
let kanban: KanbanClient;

beforeAll(() => {
  const token = buildAdminToken(ctx.jwtSecret);
  api = new ApiClient({ baseUrl: `${ctx.apiHttp}/api`, token });
  kanban = new KanbanClient(ctx.kanbanHttp, token);
});

async function waitForWorkflowByWorkItem(
  workItemId: string,
  afterRunId?: string,
  timeoutMs = 30_000,
): Promise<{ id: string }> {
  return pollUntil(
    async () => {
      const list = await api.get<{
        success: boolean;
        data: Array<{ id: string }>;
      }>(`/workflows/runs?contextId=${workItemId}&limit=10`);
      // Exclude the run we already waited on (afterRunId) to detect the NEXT run
      const candidates = list.data.filter((r) => r.id !== afterRunId);
      return candidates[0] ?? null;
    },
    (r) => r !== null,
    {
      timeoutMs,
      intervalMs: 2_000,
      label: `new workflow run for ${workItemId}`,
    },
  );
}

async function waitForCompleted(
  runId: string,
  timeoutMs = 180_000,
): Promise<void> {
  await pollUntil(
    async () => {
      const r = await api.get<{
        success: boolean;
        data: { id: string; status: string };
      }>(`/workflows/runs/${runId}`);
      return r.data;
    },
    (r) => r.status === "COMPLETED" || r.status === "FAILED",
    { timeoutMs, intervalMs: 3_000, label: `run ${runId}` },
  );
}

async function waitForItemStatus(
  projectId: string,
  workItemId: string,
  expectedStatus: string,
  timeoutMs = 60_000,
): Promise<void> {
  await pollUntil(
    () => kanban.getWorkItem(projectId, workItemId),
    (item) => item.status === expectedStatus,
    {
      timeoutMs,
      intervalMs: 2_000,
      label: `work item ${workItemId} → ${expectedStatus}`,
    },
  );
}

// step_complete is the tool that ends a step in both:
//   - work-item-in-progress-default.workflow.yaml
//   - work-item-ready-to-merge-default.workflow.yaml
// The in-review workflow uses set_job_output with decision: accept (see qa-review spec).
const STEP_END_TOOL = "step_complete";

describe("Kanban lifecycle: create → done", () => {
  it(`drives a work item through all statuses with scripted LLM turns (step tool: ${STEP_END_TOOL})`, async () => {
    // ── Phase 1: Create ──────────────────────────────────────────────────────
    const project = await kanban.createProject(`lifecycle-${Date.now()}`);
    const workItem = await kanban.createWorkItem(
      project.id,
      "e2e: full lifecycle",
    );
    expect(workItem.status).toBe("todo");

    // ── Phase 2: in-progress → triggers in-progress workflow ─────────────────
    // The fake LLM global scenario must return a step_complete tool call to
    // complete the implementation step and auto-transition the item to in-review.
    await kanban.transitionWorkItem(project.id, workItem.id, "in-progress");

    const inProgressRun = await waitForWorkflowByWorkItem(workItem.id);
    await waitForCompleted(inProgressRun.id);

    // The workflow should auto-transition to in-review after step_complete
    await waitForItemStatus(project.id, workItem.id, "in-review", 60_000);

    // ── Phase 3: in-review → triggers in-review workflow ─────────────────────
    // The fake LLM must return a set_job_output call with decision: accept
    // (same as the QA review accept path spec).
    const inReviewRun = await waitForWorkflowByWorkItem(
      workItem.id,
      inProgressRun.id,
    );
    await waitForCompleted(inReviewRun.id);

    await waitForItemStatus(project.id, workItem.id, "ready-to-merge", 60_000);

    // ── Phase 4: ready-to-merge → triggers pre-merge workflow ────────────────
    // The fake LLM must return a step_complete call to finalise the merge step.
    const mergeRun = await waitForWorkflowByWorkItem(
      workItem.id,
      inReviewRun.id,
    );
    await waitForCompleted(mergeRun.id);

    await waitForItemStatus(project.id, workItem.id, "done", 60_000);

    // ── Final assertion: work item is done ───────────────────────────────────
    const finalItem = await kanban.getWorkItem(project.id, workItem.id);
    expect(finalItem.status).toBe("done");
  }, 600_000);
});
