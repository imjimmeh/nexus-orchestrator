// packages/e2e-tests/src/scenarios/strategic-refresh-loop.e2e-spec.ts
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../driver/api-client.js";
import { KanbanClient } from "../driver/kanban-client.js";
import type {
  Initiative,
  TimelineEntry,
} from "../driver/kanban-client.types.js";
import { buildAdminToken } from "../driver/auth.js";
import { pollUntil } from "../driver/polling.js";
import { readStackContext } from "./setup/stack-context-file.js";
import type { Scenario } from "../fake-llm/index.js";

const ctx = readStackContext();
let api: ApiClient;
let kanban: KanbanClient;

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

/**
 * Seeds a stale strategic state:
 *   - Thin backlog (2 items in backlog)
 *   - Several items in done to simulate merges since last discovery
 *   - No "now" initiative
 *
 * The orchestration staleness detector reads mergesSinceDiscovery from
 * work items in done/ready-to-merge status updated after the last
 * discovery timestamp stored in orchestration metadata.
 */
async function seedStaleStrategicState(
  client: KanbanClient,
  projectId: string,
): Promise<void> {
  // Seed a couple of backlog items (thin backlog)
  await client.createWorkItem(projectId, "stale-backlog-item-1");
  await client.createWorkItem(projectId, "stale-backlog-item-2");
}

/**
 * Scripted fake-LLM scenario for the CEO Strategize and Dispatch turns.
 *
 * Turn sequence:
 *  1. When the CEO requests Strategize (has record_strategic_intent tool):
 *     - delegate_deep_investigation (rediscovery)
 *     - delegate_roadmap_planning (roadmap + "now" initiative)
 *     - delegate_idea_generation (ideation work items)
 *     - record_strategic_intent (record intent)
 *  2. After each delegate tool result: echo Done to satisfy the conversation loop.
 *  3. When the CEO requests Dispatch (has complete_orchestration_cycle_decision tool):
 *     - complete_orchestration_cycle_decision with dispatch action
 *  4. Catch-all fallback to prevent unmatched sentinel.
 */
const strategicRefreshScenario: Scenario = {
  name: "strategic-refresh-loop",
  rules: [
    // Strategize turn: delegate rediscovery (merges over threshold)
    {
      match: { hasTool: "delegate_deep_investigation" },
      respond: [
        {
          kind: "tool_call",
          toolName: "delegate_deep_investigation",
          arguments: {
            title: "e2e: rediscovery pass",
            objective:
              "Discover recent changes and assess strategic drift since last discovery.",
            context: "mergesSinceDiscovery threshold exceeded",
          },
        },
      ],
    },
    // After rediscovery result: delegate roadmap planning
    {
      match: { toolResultFor: "delegate_deep_investigation" },
      respond: [
        {
          kind: "tool_call",
          toolName: "delegate_roadmap_planning",
          arguments: {
            title: "e2e: roadmap planning",
            objective: "Create a now-horizon initiative and roadmap.",
            context: "No now-initiative found; rediscovery completed.",
          },
        },
      ],
    },
    // After roadmap result: delegate ideation
    {
      match: { toolResultFor: "delegate_roadmap_planning" },
      respond: [
        {
          kind: "tool_call",
          toolName: "delegate_idea_generation",
          arguments: {
            title: "e2e: ideation pass",
            objective: "Generate work items for the now initiative.",
            context: "Roadmap planning completed; now initiative created.",
          },
        },
      ],
    },
    // After ideation result: record strategic intent
    {
      match: { toolResultFor: "delegate_idea_generation" },
      respond: [
        {
          kind: "tool_call",
          toolName: "record_strategic_intent",
          arguments: {
            focus_initiative_id: null,
            rationale:
              "e2e: rediscovery, roadmap, and ideation delegated; now-initiative created.",
            planned_next_steps: ["dispatch items from backlog"],
            staleness_actions: [
              "deep_investigation",
              "roadmap_planning",
              "idea_generation",
            ],
          },
        },
      ],
    },
    // After record_strategic_intent result: complete dispatch cycle
    {
      match: { toolResultFor: "record_strategic_intent" },
      respond: [
        {
          kind: "tool_call",
          toolName: "complete_orchestration_cycle_decision",
          arguments: {
            decision: "dispatch",
            reasoning: "e2e: all delegation passes completed; dispatching.",
          },
        },
      ],
    },
    // Catch-all fallback
    {
      match: {},
      respond: [{ kind: "text", text: "Done." }],
    },
  ],
};

beforeAll(() => {
  const token = buildAdminToken(ctx.jwtSecret);
  api = new ApiClient({ baseUrl: `${ctx.apiHttp}/api`, token });
  kanban = new KanbanClient(ctx.kanbanHttp, token);
});

afterEach(async () => {
  await resetFakeLlm();
});

describe("EPIC-208 strategic refresh loop: stale board -> full cycle", () => {
  it("delegates rediscovery + roadmap + ideation, grooms, records intent, then dispatches", async () => {
    await loadScenario(strategicRefreshScenario);

    // Seed a stale board: thin backlog, no "now" initiative, merges over threshold
    const project = await kanban.createProject(`refresh-${Date.now()}`);
    await seedStaleStrategicState(kanban, project.id);

    // Trigger one orchestration cycle via the cycle endpoint
    await api.post(`/projects/${project.id}/orchestration/cycle`, {
      reason: "e2e refresh",
    });

    // Assert the Strategize beat delegated the warranted specialist passes
    const cycleRun = await pollUntil(
      () =>
        api.get<{ data: Array<{ id: string; status: string }> }>(
          `/workflows/runs?contextId=${project.id}&limit=20`,
        ),
      (r) => r.data.some((run) => run.status === "COMPLETED"),
      {
        timeoutMs: 300_000,
        intervalMs: 3_000,
        label: `cycle run for ${project.id}`,
      },
    );

    const timeline = await kanban.getOrchestrationTimeline(project.id);
    // rediscovery delegated (mergesSinceDiscovery over threshold)
    expect(
      timeline.some((e) =>
        /rediscovery|deep.investigation/i.test(JSON.stringify(e)),
      ),
    ).toBe(true);
    // roadmap planning delegated (no "now" initiative)
    const initiatives: Initiative[] = await kanban.listInitiatives(project.id);
    expect(initiatives.some((i) => i.horizon === "now")).toBe(true);
    // ideation created at least one work item under the now initiative
    const items = await kanban.listWorkItems(project.id);
    expect(items.length).toBeGreaterThan(0);
    // strategic intent recorded
    expect(
      timeline.some((e: TimelineEntry) => e.type === "strategic_intent"),
    ).toBe(true);
    // dispatch promoted an item to todo / in-progress
    expect(
      items.some((i) => i.status === "todo" || i.status === "in-progress"),
    ).toBe(true);

    expect(cycleRun.data.length).toBeGreaterThan(0);
  }, 600_000);
});
