import { CoreHttpClient } from "./core-http.client";

describe("CoreHttpClient", () => {
  it("posts workflow run requests to the core internal endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            run_id: "run-1",
            workflowId: "workflow-1",
            status: "accepted",
            acceptedAt: "2026-04-13T00:00:00.000Z",
            metadata: {
              correlation_id: "corr-1",
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new CoreHttpClient({
      baseUrl: "http://localhost:3010",
      fetchImpl: fetchMock,
    });

    const response = await client.requestWorkflowRun({
      workflowId: "workflow-1",
      input: { objective: "validate" },
      launchSource: "manual",
      metadata: {
        correlation_id: "corr-1",
      },
    });

    expect(response.run_id).toBe("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/internal/core/workflow-runs",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("sends correlation ID when reading run status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            run_id: "run-2",
            workflowId: "workflow-2",
            status: "RUNNING",
            updatedAt: "2026-04-13T00:01:00.000Z",
            metadata: {
              correlation_id: "corr-2",
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new CoreHttpClient({
      baseUrl: "http://localhost:3010/",
      fetchImpl: fetchMock,
    });

    await client.getWorkflowRunStatus("run-2", "corr-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/internal/core/workflow-runs/run-2",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-correlation-id": "corr-2",
        }),
      }),
    );
  });

  it("propagates correlation and causation headers when requesting runs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            run_id: "run-2b",
            workflowId: "workflow-2b",
            status: "accepted",
            acceptedAt: "2026-04-13T00:01:15.000Z",
            metadata: {
              correlation_id: "corr-2b",
              causation_id: "cause-2b",
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new CoreHttpClient({
      baseUrl: "http://localhost:3010",
      fetchImpl: fetchMock,
    });

    await client.requestWorkflowRun({
      workflowId: "workflow-2b",
      input: { objective: "trace headers" },
      launchSource: "manual",
      metadata: {
        correlation_id: "corr-2b",
        causation_id: "cause-2b",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/internal/core/workflow-runs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-correlation-id": "corr-2b",
          "x-causation-id": "cause-2b",
        }),
      }),
    );
  });

  it("resolves authorization headers per request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            run_id: "run-2c",
            workflowId: "workflow-2c",
            status: "accepted",
            acceptedAt: "2026-04-13T00:02:00.000Z",
            metadata: {
              correlation_id: "corr-2c",
            },
          },
        }),
        { status: 200 },
      ),
    );
    const authorizationHeaderResolver = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue("Bearer dynamic-service-token");

    const client = new CoreHttpClient({
      baseUrl: "http://localhost:3010",
      fetchImpl: fetchMock,
      authorizationHeaderResolver,
    });

    await client.requestWorkflowRun({
      workflowId: "workflow-2c",
      input: { objective: "dynamic auth" },
      launchSource: "manual",
      metadata: {
        correlation_id: "corr-2c",
      },
    });

    expect(authorizationHeaderResolver).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/internal/core/workflow-runs",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer dynamic-service-token",
        }),
      }),
    );
  });

  it("throws without retrying when the core endpoint returns a client error status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 400 }));
    const client = new CoreHttpClient({
      baseUrl: "http://localhost:3010",
      fetchImpl: fetchMock,
    });

    await expect(
      client.requestWorkflowRun({
        workflowId: "workflow-3",
        input: {},
        launchSource: "manual",
        metadata: {
          correlation_id: "corr-3",
        },
      }),
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on a retriable server error status then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ runId: "run-503" }), { status: 200 }),
      );
    const client = new CoreHttpClient({
      baseUrl: "http://localhost:3010",
      fetchImpl: fetchMock,
    });

    await client.requestWorkflowRun({
      workflowId: "workflow-retry",
      input: {},
      launchSource: "manual",
      metadata: {
        correlation_id: "corr-retry",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("publishes core lifecycle envelopes to the internal core events endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(undefined, { status: 204 }));
    const client = new CoreHttpClient({
      baseUrl: "http://localhost:3010",
      fetchImpl: fetchMock,
    });

    await client.publishCoreEvent({
      eventId: "event-1",
      eventType: "core.workflow.run.status_changed.v1",
      eventVersion: "v1",
      occurredAt: "2026-04-14T00:00:00.000Z",
      correlation_id: "corr-1",
      sourceService: "core",
      payload: {
        run_id: "run-1",
        workflowId: "workflow-1",
        status: "RUNNING",
        scope_id: "scope-1",
        context_id: "resource-1",
      },
      metadata: {
        requestedBy: "unit-test",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/internal/core/events",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
