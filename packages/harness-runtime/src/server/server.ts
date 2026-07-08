/**
 * Harness Runtime HTTP server.
 *
 * A long-lived HTTP server that accepts step execution requests from the
 * Nexus API. Each step in a multi-step job runs within the same container,
 * sharing filesystem state.
 *
 * Endpoints:
 *   GET  /health           — readiness probe
 *   POST /execute/agent    — run an agent session with a given prompt/config
 *   POST /execute/command  — run a shell command, return stdout/stderr/exit_code
 *   POST /shutdown         — graceful teardown
 */

import * as http from "node:http";
import { spawn } from "node:child_process";
import type { HarnessEngine } from "../engine/harness-engine.js";
import type { HarnessSessionContext } from "../engine/session-context.js";
import type { OrchestratorClient } from "../gateway/orchestrator-client.js";
import type { HarnessEnvConfig } from "../config/config.js";
import type { HarnessServer } from "./server.types.js";
import {
  executeAgentStep,
  resolveRequestAuth,
  type ExecuteAgentRequest,
} from "./server.execution.js";
import { ChunkBatcher } from "./chunk-batcher.js";
import {
  COMMAND_STARTED_EVENT,
  COMMAND_OUTPUT_EVENT,
  COMMAND_FINISHED_EVENT,
} from "@nexus/core";

export type { HarnessServer } from "./server.types.js";
export { executeAgentStep } from "./server.execution.js";

const DEFAULT_PORT = 8374;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
// Must comfortably exceed the longest legitimate run_command workload — notably
// the auto-merge quality gate (build + lint + full test suites), which takes
// several minutes. A lower cap silently kills the gate mid-run and makes the
// merge workflow structurally unwinnable.
export const MAX_COMMAND_TIMEOUT_MS = 1_800_000;

// ---------------------------------------------------------------------------
// Request / Response helpers
// ---------------------------------------------------------------------------

interface ExecuteCommandRequest {
  command: string;
  timeoutMs?: number;
  workingDir?: string;
  stepId?: string;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

const OUTPUT_TAIL_MAX_CHARS = 16_384;
type CommandEmit = (event: string, data: unknown) => void;

export async function defaultExecuteCommand(
  request: ExecuteCommandRequest,
  defaultWorkingDir: string,
  emit?: CommandEmit,
): Promise<{
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}> {
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, 1),
    MAX_COMMAND_TIMEOUT_MS,
  );
  const cwd = request.workingDir ?? defaultWorkingDir;
  const { stepId } = request;

  // Resolve a narrowed emitter bound to the stepId; null means no streaming.
  const safeEmit:
    | ((event: string, data: Record<string, unknown>) => void)
    | null =
    emit && stepId
      ? (event, data) => {
          emit(event, { ...data, stepId });
        }
      : null;

  let seq = 0;
  const emitChunk = (stream: "stdout" | "stderr") => (text: string) => {
    safeEmit?.(COMMAND_OUTPUT_EVENT, { stream, chunk: text, seq: seq++ });
  };
  const stdoutBatcher = new ChunkBatcher(emitChunk("stdout"));
  const stderrBatcher = new ChunkBatcher(emitChunk("stderr"));

  let stdout = "";
  let stderr = "";
  const tail = (): string => (stdout + stderr).slice(-OUTPUT_TAIL_MAX_CHARS);

  safeEmit?.(COMMAND_STARTED_EVENT, { command: request.command });

  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", request.command], {
      cwd,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });

    child.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf-8");
      stdout += text;
      stdoutBatcher.push(text);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf-8");
      stderr += text;
      stderrBatcher.push(text);
    });

    // Node guarantees "close" fires after "error", so on a spawn failure (e.g.
    // bad cwd) finish() would be called twice — once by "error" and once by
    // "close". The guard makes it idempotent: only the first invocation wins.
    let finished = false;
    const finish = (exitCode: number, timedOut: boolean) => {
      if (finished) return;
      finished = true;
      stdoutBatcher.flush();
      stderrBatcher.flush();
      stdoutBatcher.stop();
      stderrBatcher.stop();
      const ok = exitCode === 0 && !timedOut;
      safeEmit?.(COMMAND_FINISHED_EVENT, {
        exitCode,
        timedOut,
        ok,
        outputTail: tail().trimEnd(),
      });
      resolve({
        ok,
        exit_code: exitCode,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        timed_out: timedOut,
      });
    };

    child.on("error", () => {
      finish(1, false);
    });
    child.on("close", (code, signal) => {
      const timedOut = signal === "SIGKILL";
      finish(typeof code === "number" ? code : 1, timedOut);
    });
  });
}

async function gracefullyDisconnectClient(
  client: OrchestratorClient,
): Promise<void> {
  try {
    await client.disconnect();
  } catch {
    // best-effort
  }
}

interface ServerRequestDeps {
  envConfig: HarnessEnvConfig;
  client: OrchestratorClient;
  engine: HarnessEngine;
  ctx: HarnessSessionContext;
  isShuttingDown: () => boolean;
  setShuttingDown: (value: boolean) => void;
  closeServer: () => void;
}

function isRoute(
  req: http.IncomingMessage,
  method: string,
  url: string,
): boolean {
  return (req.method ?? "GET") === method && (req.url ?? "/") === url;
}

function handleHealthRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  if (!isRoute(req, "GET", "/health")) {
    return false;
  }

  sendJson(res, 200, { status: "ok" });
  return true;
}

async function handleExecuteAgentRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ServerRequestDeps,
): Promise<boolean> {
  if (!isRoute(req, "POST", "/execute/agent")) {
    return false;
  }

  if (deps.isShuttingDown()) {
    sendJson(res, 503, { error: "Server is shutting down" });
    return true;
  }

  if (!deps.client.connected) {
    sendJson(res, 503, {
      error: "Telemetry gateway not yet connected — retry soon",
    });
    return true;
  }

  const raw = await readBody(req);
  const body = parseJson(raw) as ExecuteAgentRequest | null;

  if (!body) {
    sendJson(res, 400, {
      error: "Missing required fields: provider, model, auth, stepId",
    });
    return true;
  }

  const missingRequiredFields: string[] = [];
  if (!body.provider) {
    missingRequiredFields.push("provider");
  }
  if (!body.model) {
    missingRequiredFields.push("model");
  }
  if (!resolveRequestAuth(body)) {
    missingRequiredFields.push("auth");
  }
  if (!body.stepId) {
    missingRequiredFields.push("stepId");
  }

  if (missingRequiredFields.length > 0) {
    sendJson(res, 400, {
      error: `Missing required fields: ${missingRequiredFields.join(", ")}`,
    });
    return true;
  }

  const executeRequest: ExecuteAgentRequest = body;

  if (executeRequest.mode === "async") {
    sendJson(res, 202, { ok: true, accepted: true });
    void executeAgentStep(deps.envConfig, deps.client, deps.engine, deps.ctx, {
      ...executeRequest,
      background: true,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      deps.client.emit("agent_error", {
        message,
        stepId: executeRequest.stepId,
      });
    });
    return true;
  }

  try {
    const result = await executeAgentStep(
      deps.envConfig,
      deps.client,
      deps.engine,
      deps.ctx,
      executeRequest,
    );
    sendJson(res, 200, result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }

  return true;
}

async function handleExecuteCommandRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ServerRequestDeps,
): Promise<boolean> {
  if (!isRoute(req, "POST", "/execute/command")) {
    return false;
  }

  if (deps.isShuttingDown()) {
    sendJson(res, 503, { error: "Server is shutting down" });
    return true;
  }

  if (!deps.client.connected) {
    sendJson(res, 503, {
      error: "Telemetry gateway not yet connected — retry soon",
    });
    return true;
  }

  const raw = await readBody(req);
  const body = parseJson(raw) as ExecuteCommandRequest | null;
  if (!body?.command) {
    sendJson(res, 400, { error: "Missing required field: command" });
    return true;
  }

  try {
    let result: Awaited<ReturnType<typeof defaultExecuteCommand>>;
    if (deps.engine.executeCommand) {
      result = await deps.engine.executeCommand(body);
    } else {
      result = await defaultExecuteCommand(
        body,
        deps.envConfig.workspacePath,
        (event, data) => {
          deps.client.emit(event, data);
        },
      );
    }
    sendJson(res, 200, result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }

  return true;
}

function handleShutdownRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ServerRequestDeps,
): boolean {
  if (!isRoute(req, "POST", "/shutdown")) {
    return false;
  }

  deps.setShuttingDown(true);
  sendJson(res, 200, { status: "shutting_down" });

  setTimeout(() => {
    void (async () => {
      await gracefullyDisconnectClient(deps.client);
      deps.closeServer();
    })();
  }, 500);
  return true;
}

async function handleServerRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ServerRequestDeps,
): Promise<void> {
  if (handleHealthRoute(req, res)) {
    return;
  }

  if (await handleExecuteAgentRoute(req, res, deps)) {
    return;
  }

  if (await handleExecuteCommandRoute(req, res, deps)) {
    return;
  }

  if (handleShutdownRoute(req, res, deps)) {
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export async function startServer(params: {
  envConfig: HarnessEnvConfig;
  client: OrchestratorClient;
  engine: HarnessEngine;
  ctx: HarnessSessionContext;
  portOverride?: number;
}): Promise<HarnessServer> {
  const { envConfig, client, engine, ctx, portOverride } = params;
  const port = portOverride ?? DEFAULT_PORT;

  console.log(
    `Harness Runtime server starting | harness=${envConfig.harnessId} step=${envConfig.stepId} session=${envConfig.sessionId}`,
  );

  let shuttingDown = false;

  const server = http.createServer((req, res) => {
    void handleServerRequest(req, res, {
      envConfig,
      client,
      engine,
      ctx,
      isShuttingDown: () => shuttingDown,
      setShuttingDown: (value: boolean) => {
        shuttingDown = value;
      },
      closeServer: () => {
        server.close();
      },
    });
  });

  const assignedPort = await new Promise<number>((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      const addr = server.address();
      const actualPort =
        addr !== null && typeof addr === "object" ? addr.port : port;
      console.log(`Harness Runtime server listening on port ${actualPort}`);
      resolve(actualPort);
    });
  });

  // Connect WebSocket for telemetry in background — must not block /health.
  // Execute routes return 503 until the connection is established.
  void client
    .connect()
    .then(() => {
      console.log("Connected to Telemetry Gateway");

      // Drain the configure event if the gateway sends one (backward compat)
      client.waitForConfig().catch(() => {
        /* ignore — config comes via HTTP in server mode */
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Telemetry Gateway connection failed: ${message}`);
    });

  return {
    port: assignedPort,
    close: () =>
      new Promise<void>((resolve) => {
        shuttingDown = true;
        void client.disconnect().catch(() => {
          // best-effort
        });
        server.close(() => {
          resolve();
        });
      }),
  };
}
