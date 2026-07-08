import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import { startServer } from "./server.js";

describe("handleExecuteAgentRoute — async mode", () => {
  let server: { close(): Promise<void>; port: number };
  let executeAgentStepSpy: ReturnType<typeof vi.fn>;

  const makeValidBody = (overrides: Record<string, unknown> = {}) => ({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    auth: { type: "api_key", apiKey: "test-key" },
    stepId: "step-1",
    systemPrompt: "You are a test agent.",
    ...overrides,
  });

  function post(
    path: string,
    body: unknown,
  ): Promise<{ status: number; data: unknown }> {
    return new Promise((resolve, reject) => {
      const json = JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: server.port,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(json),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                data: JSON.parse(Buffer.concat(chunks).toString()),
              });
            } catch {
              reject(new Error("Failed to parse response"));
            }
          });
        },
      );
      req.on("error", reject);
      req.write(json);
      req.end();
    });
  }

  beforeEach(async () => {
    const mod = await import("./server.execution.js");
    executeAgentStepSpy = vi
      .spyOn(mod, "executeAgentStep")
      .mockResolvedValue({ ok: true, response: "done" });

    server = await startServer({
      portOverride: 0,
      engine: { createSession: vi.fn() } as never,
      client: {
        connected: true,
        emit: vi.fn(),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        waitForConfig: vi.fn().mockResolvedValue(undefined),
      } as never,
      ctx: {} as never,
      envConfig: { harnessId: "test", sessionId: "sess-1" } as never,
    });
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  it("returns 202 with accepted:true for mode=async", async () => {
    const { status, data } = await post(
      "/execute/agent",
      makeValidBody({ mode: "async" }),
    );
    expect(status).toBe(202);
    expect(data).toMatchObject({ ok: true, accepted: true });
  });

  it("still calls executeAgentStep for async mode (background)", async () => {
    await post("/execute/agent", makeValidBody({ mode: "async" }));
    // Give the micro-task queue a tick to ensure the background call fires
    await new Promise((r) => setTimeout(r, 50));
    expect(executeAgentStepSpy).toHaveBeenCalledOnce();
    // Verify background:true was passed
    const callArg = executeAgentStepSpy.mock.calls[0][4] as Record<
      string,
      unknown
    >;
    expect(callArg["background"]).toBe(true);
  });

  it("returns 200 for sync mode (no mode field)", async () => {
    const { status } = await post("/execute/agent", makeValidBody());
    expect(status).toBe(200);
  });
});
