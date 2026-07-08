import { describe, expect, it } from "vitest";

import {
  buildApiCallbackSuccessResult,
  executeApiCallback,
} from "./api-callback.js";

const PROJECT_SCOPED_TOOL = "kanban.project_state";

describe("executeApiCallback project scope validation", () => {
  it("rejects default project ids before calling project-scoped tools", async () => {
    const result = await executeApiCallback({
      toolName: PROJECT_SCOPED_TOOL,
      callback: {
        method: "POST",
        path_template: "/tools/project-state",
      },
      toolParams: { project_id: "default" },
      apiBaseUrl: "http://nexus-api:3010",
      agentJwt: "invalid-token",
    });

    expect(result.details?.ok).toBe(false);
    expect(result.details?.error).toBe("unresolved_project_id");
    expect(result.content[0]?.text).toContain("Project id was not resolved");
  });
});

describe("buildApiCallbackSuccessResult — suspend directive", () => {
  it("sets terminate when nested data.executionStatus is 'suspended'", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "await_agent_workflow",
      status: 200,
      responseText: "{}",
      responseData: {
        success: true,
        data: {
          ok: true,
          requestedAction: "await_agent_workflow",
          executionStatus: "suspended",
          awaitId: "a1",
          awaitedRunIds: ["r1"],
        },
      },
      attempt: 1,
    });

    expect(result.terminate).toBe(true);
    expect(result.details?.ok).toBe(true);
  });

  it("does not set terminate for an ordinary success", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "query_memory",
      status: 200,
      responseText: "{}",
      responseData: { success: true, data: { ok: true } },
      attempt: 1,
    });

    expect(result.terminate ?? false).toBe(false);
  });

  it("sets terminate when top-level executionStatus is 'completed'", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "step_complete",
      status: 200,
      responseText: "{}",
      responseData: { success: true, ok: true, executionStatus: "completed" },
      attempt: 1,
    });

    expect(result.terminate).toBe(true);
    expect(result.details?.ok).toBe(true);
  });

  it("sets terminate when top-level executionStatus is 'terminated' on a rejection", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "step_complete",
      status: 200,
      responseText: "{}",
      responseData: {
        success: false,
        ok: false,
        error: "Workflow run is terminal",
        executionStatus: "terminated",
      },
      attempt: 1,
    });

    expect(result.terminate).toBe(true);
    expect(result.details?.ok).toBe(false);
  });

  it("does not set terminate for an ok:false denial without executionStatus", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "step_complete",
      status: 200,
      responseText: "{}",
      responseData: {
        success: false,
        ok: false,
        error: "Step completion denied",
        missing_fields: ["summary"],
      },
      attempt: 1,
    });

    expect(result.terminate ?? false).toBe(false);
    expect(result.details?.ok).toBe(false);
  });

  it("sets terminate when nested data.executionStatus is 'completed'", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "step_complete",
      status: 200,
      responseText: "{}",
      responseData: {
        success: true,
        data: { ok: true, executionStatus: "completed" },
      },
      attempt: 1,
    });

    expect(result.terminate).toBe(true);
  });
});
