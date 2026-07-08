// packages/e2e-tests/src/__tests__/spike.e2e-spec.ts
//
// Networking spike: verifies that a runner container can reach the fake LLM
// server and complete a single-step workflow without real AI.
//
// This spec runs within the e2e harness alongside scenario specs; it reuses the
// shared stack context written by global-setup.ts rather than starting its own
// Docker stack.
import { beforeAll, describe, expect, it } from "vitest";
import { scenario, text } from "../fake-llm/index.js";
import { readStackContext } from "../scenarios/setup/stack-context-file.js";
import { ApiClient } from "../driver/api-client.js";
import { buildAdminToken } from "../driver/auth.js";
import { pollUntil } from "../driver/polling.js";

// Replace with the name field of any simple one-step seed workflow
const WORKFLOW_NAME = "Orchestration Invoke Agent Default";

const ctx = readStackContext();
let api: ApiClient;

beforeAll(() => {
  api = new ApiClient({
    baseUrl: `${ctx.apiHttp}/api`,
    token: buildAdminToken(ctx.jwtSecret),
  });
});

describe("Networking spike: runner container reaches fake LLM", () => {
  it("completes a single-step workflow via the fake LLM with no real AI", async () => {
    // Load a catch-all scenario into the shared fake LLM via the control server
    const controlBase = `http://127.0.0.1:${ctx.fakeLlmControlPort}`;
    const loadRes = await fetch(`${controlBase}/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        scenario("spike").otherwise(text("spike done")).build(),
      ),
    });
    if (!loadRes.ok) {
      throw new Error(`Failed to load spike scenario: ${await loadRes.text()}`);
    }

    // Look up the workflow id by name.
    // Use a large limit to ensure we scan past the default page size of 20.
    const workflows = await api.get<{
      success: boolean;
      data: Array<{ id: string; name: string }>;
    }>("/workflows?limit=100");
    const workflow = workflows.data.find((w) => w.name === WORKFLOW_NAME);
    expect(
      workflow,
      `seed workflow '${WORKFLOW_NAME}' not found in /api/workflows`,
    ).toBeDefined();

    // Trigger a run via the execute endpoint.
    // The execute endpoint returns { success, data: { runId } } (camelCase).
    if (!workflow) {
      throw new Error(
        `seed workflow '${WORKFLOW_NAME}' not found in /api/workflows`,
      );
    }
    const runResponse = await api.post<{
      success: boolean;
      data: { runId: string };
    }>(`/workflows/${workflow.id}/execute`, {
      trigger_data: { source: "e2e-spike" },
    });
    const runId = runResponse.data.runId;
    expect(runId).toBeDefined();

    // Poll until COMPLETED or FAILED (max 3 min)
    const finalRun = await pollUntil(
      async () => {
        const r = await api.get<{
          success: boolean;
          data: { id: string; status: string };
        }>(`/workflows/runs/${runId}`);
        return r.data;
      },
      (r) => r.status === "COMPLETED" || r.status === "FAILED",
      { timeoutMs: 180_000, intervalMs: 3_000, label: `workflow run ${runId}` },
    );

    // The run must complete (not fail)
    expect(finalRun.status).toBe("COMPLETED");
  }, 300_000);
});
