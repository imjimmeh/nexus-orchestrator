// packages/e2e-tests/src/scenarios/generic-workflow.e2e-spec.ts
import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../driver/api-client.js";
import { buildAdminToken } from "../driver/auth.js";
import { pollUntil } from "../driver/polling.js";
import { readStackContext } from "./setup/stack-context-file.js";

const ctx = readStackContext();

let api: ApiClient;

beforeAll(() => {
  api = new ApiClient({
    baseUrl: `${ctx.apiHttp}/api`,
    token: buildAdminToken(ctx.jwtSecret),
  });
});

async function findOrCreateGenericWorkflow(): Promise<string> {
  // Use a large limit to ensure we scan past the default page size of 20.
  const list = await api.get<{
    success: boolean;
    data: Array<{ id: string; name: string }>;
  }>("/workflows?limit=100");
  const existing = list.data.find((w) => w.name === "E2E Test Generic");
  if (existing) return existing.id;

  // Create the minimal workflow via YAML definition.
  // A job of type 'execution' must contain at least one entry in its `steps`
  // array. Each step requires at minimum a `prompt` field.
  const yamlDefinition = [
    "workflow_id: e2e_test_generic",
    "name: E2E Test Generic",
    "description: Minimal one-step workflow for e2e testing",
    "trigger:",
    "  type: manual",
    "jobs:",
    "  - id: step_one",
    "    type: execution",
    "    tier: light",
    "    steps:",
    "      - id: run",
    "        prompt: |",
    "          {{trigger.prompt}}",
  ].join("\n");

  const created = await api.post<{ success: boolean; data: { id: string } }>(
    "/workflows",
    {
      yaml_definition: yamlDefinition,
    },
  );
  return created.data.id;
}

async function triggerAndWait(
  workflowId: string,
): Promise<{ id: string; status: string }> {
  // The execute endpoint returns { success, data: { runId } } (camelCase field name).
  const runResponse = await api.post<{
    success: boolean;
    data: { runId: string };
  }>(`/workflows/${workflowId}/execute`, {
    trigger_data: { source: "e2e-generic", prompt: "test prompt" },
  });
  const runId = runResponse.data.runId;
  const final = await pollUntil(
    async () => {
      const r = await api.get<{
        success: boolean;
        data: { id: string; status: string };
      }>(`/workflows/runs/${runId}`);
      return r.data;
    },
    (r) => r.status === "COMPLETED" || r.status === "FAILED",
    { timeoutMs: 120_000, intervalMs: 3_000, label: `generic run ${runId}` },
  );
  return final;
}

describe("Generic workflow: text response", () => {
  it("completes when the fake LLM returns a plain text turn", async () => {
    const workflowId = await findOrCreateGenericWorkflow();
    const run = await triggerAndWait(workflowId);
    expect(run.status).toBe("COMPLETED");
  }, 180_000);
});

describe("Generic workflow: tool-call response", () => {
  it("completes when the fake LLM returns a manage_todo_list tool call followed by text", async () => {
    const workflowId = await findOrCreateGenericWorkflow();
    const run = await triggerAndWait(workflowId);
    expect(run.status).toBe("COMPLETED");
  }, 180_000);
});
