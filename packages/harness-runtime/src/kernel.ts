/**
 * Kernel bootstrap for the harness runtime execution plane.
 *
 * Responsibilities:
 * - Engine registry: engines self-register by calling `registerEngine` on import
 * - Telemetry contract guard: rejects engines whose version doesn't match the kernel
 * - Full lifecycle bootstrap via `startKernel`
 */

import {
  CONTAINER_AGENT_DIR,
  EMPTY_HARNESS_CONTRIBUTIONS,
  type HarnessCapabilities,
  type HarnessRuntimeConfig,
} from "@nexus/core";
import type { HarnessEngine } from "./engine/harness-engine.js";
import type { HarnessSessionContext } from "./engine/session-context.js";
import { loadConfig } from "./config/config.js";
import { createOrchestratorClient } from "./gateway/orchestrator-client.js";
import { createCheckPermission } from "./governance/check-permission-client.js";
import { wrapToolWithGovernance } from "./governance/wrap-tool.js";
import {
  loadMountedToolDefinitions,
  type RunnerLocalToolHandler,
} from "./tools/mounted-tools.js";
import { buildToolCatalog } from "./tools/build-tool-catalog.js";
import type { OrchestratorClient } from "./gateway/orchestrator-client.js";
import { startServer } from "./server/server.js";
import { createTelemetryForwarder } from "./telemetry/forwarder.js";
import { applyContributions } from "./engine/apply-contributions.js";

// ---------------------------------------------------------------------------
// Telemetry contract versioning
// ---------------------------------------------------------------------------

export const KERNEL_TELEMETRY_VERSION = "v1" as const;

/**
 * Asserts that the engine's declared telemetry contract version matches the
 * version this kernel was built against. Throws if there is a mismatch.
 */
export function assertTelemetryVersion(caps: HarnessCapabilities): void {
  if (caps.telemetryContractVersion !== KERNEL_TELEMETRY_VERSION) {
    throw new Error(
      `Engine telemetry contract ${caps.telemetryContractVersion} != kernel ${KERNEL_TELEMETRY_VERSION}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Engine registry
// ---------------------------------------------------------------------------

type EngineFactory = () => HarnessEngine;
const _registry = new Map<string, EngineFactory>();

/**
 * Register an engine factory under the given harness ID.
 * Engine modules call this at module load time so `loadEngine` can find them.
 */
export function registerEngine(id: string, factory: EngineFactory): void {
  _registry.set(id, factory);
}

/**
 * Retrieve and instantiate the engine registered for `harnessId`.
 * Throws if no engine has been registered for that ID.
 */
export function loadEngine(harnessId: string): HarnessEngine {
  const factory = _registry.get(harnessId);
  if (!factory) {
    throw new Error(`No engine registered for HARNESS_ID=${harnessId}`);
  }
  return factory();
}

// ---------------------------------------------------------------------------
// Full bootstrap lifecycle
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_DIR = CONTAINER_AGENT_DIR;

/** Resolve the session's contributions, defaulting to the empty bundle. */
export function resolveSessionContributions(config: HarnessRuntimeConfig) {
  return config.contributions ?? EMPTY_HARNESS_CONTRIBUTIONS;
}

/**
 * Bootstrap the harness runtime from environment variables.
 *
 * Order of operations:
 * 1. Load env config
 * 2. Load + validate engine from registry
 * 3. Connect to orchestrator and wait for session config
 * 4. Validate engine supports this runtime config
 * 5. Build governance layer and tool set
 * 6. Build the HarnessSessionContext
 * 7. Start the HTTP server (engine injected)
 */
export async function startKernel(): Promise<void> {
  // 1. Load env config
  const envConfig = loadConfig();

  // 2. Load engine and validate telemetry contract
  const engine = loadEngine(envConfig.harnessId);
  assertTelemetryVersion(engine.capabilities);

  // 3. Connect to orchestrator and wait for session config
  const client = createOrchestratorClient(
    envConfig.websocketUrl,
    envConfig.agentJwt,
  );
  await client.connect();
  const runtimeConfig = await client.waitForConfig();

  // 4. Validate engine supports this runtime config
  const validation = engine.validate(runtimeConfig);
  if (!validation.ok) {
    throw new Error(
      `Engine validation failed: ${validation.errors?.join(", ") ?? "unknown error"}`,
    );
  }

  // 5. Build governance layer and tool set
  const checkPermission = createCheckPermission({
    apiBaseUrl: envConfig.apiBaseUrl,
    agentJwt: envConfig.agentJwt,
    workflowRunId: envConfig.isChatSession ? undefined : envConfig.sessionId,
    chatSessionId: envConfig.isChatSession ? envConfig.sessionId : undefined,
    jobId: envConfig.jobId,
  });

  const runnerLocalHandler = buildRunnerLocalHandler(client);

  const rawTools = loadMountedToolDefinitions(
    envConfig.extensionsPath,
    {
      apiBaseUrl: envConfig.apiBaseUrl,
      agentJwt: envConfig.agentJwt,
      workflowRunId: envConfig.isChatSession ? undefined : envConfig.sessionId,
      workspacePath: envConfig.workspacePath,
    },
    runnerLocalHandler,
  );

  const governedTools = rawTools.map((tool) =>
    wrapToolWithGovernance(tool, checkPermission),
  );

  // 6. Build session context
  const ctx: HarnessSessionContext = {
    governedTools,
    // Raw tool catalog for permission_callback engines (e.g. claude-code).
    // Derived from the same mounted tools as `governedTools` so the claude-code
    // tool surface (set_job_output, query_memory, kanban.*, delegate_*, ...)
    // matches PI's; governance is applied by the engine's canUseTool callback.
    toolCatalog: buildToolCatalog(rawTools),
    checkPermission,
    workspacePath: envConfig.workspacePath,
    agentDir: DEFAULT_AGENT_DIR,
    extensionsPath: envConfig.extensionsPath,
    sessionPath: envConfig.sessionPath,
    contributions: resolveSessionContributions(runtimeConfig),
  };

  await applyContributions(engine, ctx);

  // 7. Start HTTP server — the server manages per-request session lifecycle.
  // Telemetry forwarding is wired per-session inside executeAgentStep.
  // The telemetry forwarder is available for engines that need a persistent
  // top-level subscription (e.g. long-lived chat engines).
  const _forwarder = createTelemetryForwarder(client);
  void _forwarder; // available for future engine-level wiring

  await startServer({ envConfig, client, engine, ctx });
}

// ---------------------------------------------------------------------------
// Runner-local tool handler
// ---------------------------------------------------------------------------

/**
 * How long a single `waitForCommand` window stays armed before it is re-armed.
 * This is NOT a deadline for the user: when the window elapses without an
 * answer the handler simply loops and waits again.
 */
const QUESTION_WAIT_RETRY_MS = 30 * 60 * 1000;

/**
 * Build the runner-local tool handler bound to an orchestrator client.
 *
 * The only runner-local tool today is `ask_user_questions`. The handler posts
 * the questions and then waits indefinitely for the user's answer. The
 * orchestrator owns the interaction lifecycle: the question is persisted
 * server-side, idle containers are stopped/removed by the question idle
 * tracker, and late answers resume the session. Fabricating a timeout answer
 * would let the agent continue without the user's input — so this handler must
 * never do that.
 */
export function buildRunnerLocalHandler(
  client: Pick<OrchestratorClient, "emit" | "waitForCommand">,
): RunnerLocalToolHandler {
  return async (toolName, params) => {
    if (toolName === "ask_user_questions") {
      const questions =
        (params.questions as Array<{ question: string; options?: string[] }>) ??
        [];
      client.emit("user_questions_posed", { questions });

      // Wait indefinitely. Each `waitForCommand` arms a finite window; when it
      // elapses without an answer we re-arm and keep waiting. We never return a
      // synthetic timeout result.
      for (;;) {
        try {
          const response = await client.waitForCommand(
            "question_response",
            QUESTION_WAIT_RETRY_MS,
          );
          const answers = response.answers ?? [];
          const formatted = questions
            .map((q, i) => {
              const answer = answers[i];
              const answerText =
                answer?.freeTextAnswer ??
                answer?.selectedOption ??
                "(no answer)";
              return `Q${(i + 1).toString()}: ${q.question}\nA: ${answerText}`;
            })
            .join("\n\n");
          return {
            content: [{ type: "text", text: formatted }],
            details: { ok: true, answers },
          };
        } catch {
          // Wait window elapsed without an answer — re-arm and keep waiting.
        }
      }
    }
    return {
      content: [
        {
          type: "text",
          text: `Runner-local tool ${toolName} is not supported.`,
        },
      ],
      details: { ok: false, error: "unsupported_runner_local_tool" },
    };
  };
}
