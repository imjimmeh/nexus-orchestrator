import type {
  HarnessEngine,
  ValidationResult,
  HarnessSessionContext,
  HookMaterializer,
  ExtensionMaterializer,
  SettingsMaterializer,
  PluginMaterializer,
} from "@nexus/harness-runtime";
import {
  registerEngine,
  buildCanonicalToolNameResolver,
  V3SessionWriter,
} from "@nexus/harness-runtime";
import {
  CLAUDE_CODE_CAPABILITIES,
  type HarnessRuntimeConfig,
  type HarnessHookAsset,
  type HarnessExtensionAsset,
  type HarnessSettingsContribution,
  type HarnessPlugin,
} from "@nexus/core";
import { deriveContributionQueryFragments } from "./contribution-sdk-mappers.js";
import { stagePlugins } from "./plugin-staging.js";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildCanUseTool } from "./govern.js";
import { NEXUS_KERNEL_MCP_SERVER, stripNexusMcpPrefix } from "./mcp-server.js";
import { buildClaudeAuthDelivery } from "./claude-code-auth-delivery.js";
import type { ClaudeAuthDeliveryMode } from "./claude-code-auth-delivery.types.js";
import { toSdkTool } from "./to-sdk-tool.js";
import { ClaudeEventMapper } from "./map-claude-event.js";
import { ClaudeV3Mapper } from "./map-claude-message-to-v3.js";
import { ClaudeCodeSession } from "./claude-code-session.js";

interface ClaudeAgentSdk {
  query(opts: {
    prompt: string | AsyncIterable<string>;
    options?: Record<string, unknown>;
  }): AsyncIterable<unknown>;
  createSdkMcpServer(opts: {
    name: string;
    version: string;
    tools: unknown[];
  }): unknown;
  tool(
    name: string,
    description: string,
    schema: unknown,
    handler: (input: Record<string, unknown>) => Promise<unknown>,
  ): unknown;
}

/**
 * Builds the best-effort v3 JSONL sink + matching mapper for a claude-code run.
 * Opens an existing session file (resume) or creates a fresh one seeded with a
 * `model_change` node. The sink is undefined on any failure so persistence never
 * blocks the run. The mapper is always returned so callers can stay uniform.
 */
function buildV3Persistence(
  config: HarnessRuntimeConfig,
  ctx: HarnessSessionContext,
): { v3Sink: V3SessionWriter | undefined; v3Mapper: ClaudeV3Mapper } {
  const provider = config.model?.provider ?? "anthropic";
  const modelId = config.model?.model ?? "unknown";
  const v3Mapper = new ClaudeV3Mapper({ provider, model: modelId });
  const opts = {
    genId: () => randomUUID().slice(0, 8),
    now: () => new Date().toISOString(),
  };
  try {
    if (existsSync(ctx.sessionPath)) {
      return { v3Sink: V3SessionWriter.open(ctx.sessionPath, opts), v3Mapper };
    }
    const v3Sink = V3SessionWriter.create(
      ctx.sessionPath,
      ctx.workspacePath,
      opts,
    );
    v3Sink.appendNode({ type: "model_change", provider, modelId });
    return { v3Sink, v3Mapper };
  } catch {
    return { v3Sink: undefined, v3Mapper }; // best-effort; never block creation
  }
}

export class ClaudeCodeEngine
  implements
    HarnessEngine,
    HookMaterializer,
    ExtensionMaterializer,
    SettingsMaterializer,
    PluginMaterializer
{
  readonly id = "claude-code" as const;
  readonly capabilities = CLAUDE_CODE_CAPABILITIES;

  // The SPI dispatch path (applyContributions) calls these at kernel bootstrap.
  // createSession also reads ctx.contributions directly, so these are
  // intentionally idempotent no-ops kept to satisfy the SPI conformance rule (a
  // declared contribution capability requires its matching materializer). They
  // store nothing the engine depends on — ctx.contributions is the single
  // source of truth and is merged into the SDK options inside createSession.
  async materializeHooks(
    _hooks: HarnessHookAsset[],
    _ctx: HarnessSessionContext,
  ): Promise<void> {}
  async materializeExtensions(
    _extensions: HarnessExtensionAsset[],
    _ctx: HarnessSessionContext,
  ): Promise<void> {}
  async materializeSettings(
    _settings: HarnessSettingsContribution,
    _ctx: HarnessSessionContext,
  ): Promise<void> {}
  // Plugin materialization is handled entirely inside `createSession` (file
  // staging + SDK option assembly). This no-op satisfies the PluginMaterializer
  // SPI so the engine conforms to the declared `supportsPlugins: true` capability.
  async materializePlugins(
    _plugins: HarnessPlugin[],
    _ctx: HarnessSessionContext,
  ): Promise<void> {}

  validate(config: HarnessRuntimeConfig): ValidationResult {
    if (!config.model?.provider)
      return { ok: false, errors: ["model.provider is required"] };
    return { ok: true };
  }

  async createSession(
    config: HarnessRuntimeConfig,
    ctx: HarnessSessionContext,
  ): Promise<ClaudeCodeSession> {
    const rawStepId = config.harnessOptions?.stepId;
    const stepId = typeof rawStepId === "string" ? rawStepId : "session";
    const mapper = new ClaudeEventMapper(stepId);

    // v3 session persistence: write the pi-compatible session JSONL so the
    // existing SessionHydrationService pipeline persists this run to
    // pi_session_trees, exactly like the pi harness.
    const { v3Sink, v3Mapper } = buildV3Persistence(config, ctx);

    // The SDK presents mounted tools under sanitized names (dots become
    // underscores in MCP tool names) and its built-ins in PascalCase, but
    // governance keys tools by their canonical catalog names (dotted
    // `kanban.project_state`, lowercase runner-native `read`). Recover the
    // canonical name before the permission check so the gate can match it.
    const resolveCanonicalToolName = buildCanonicalToolNameResolver(
      ctx.toolCatalog.map((tool) => tool.name),
    );
    const canUseTool = buildCanUseTool((toolName, params) =>
      ctx.checkPermission(
        resolveCanonicalToolName(stripNexusMcpPrefix(toolName)),
        params,
      ),
    );

    // Durable agent-await: when a tool returns executionStatus:suspended the
    // handler calls onTerminate, which marks the session suspended and aborts
    // the in-flight query so the model gets no further turn. The session then
    // emits a clean suspended agent_end and the run stays parked for resume.
    // See kanban-atuq.
    const abortController = new AbortController();
    let sessionRef: ClaudeCodeSession | undefined;
    const onTerminate = (): void => {
      sessionRef?.suspend();
      abortController.abort();
    };
    const sdkTools = ctx.toolCatalog.map((spec) =>
      toSdkTool(spec, { onTerminate }),
    );

    // Resolve how the subscription credential reaches the CLI. `file` mode
    // writes a native ~/.claude/.credentials.json (same file `claude login`
    // writes) so the CLI authenticates as an interactive session; `env` mode
    // (default) keeps the proven CLAUDE_CODE_OAUTH_TOKEN delivery.
    const deliveryMode: ClaudeAuthDeliveryMode =
      process.env["CLAUDE_CODE_AUTH_DELIVERY"] === "file" ? "file" : "env";
    const configDir =
      process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
    const authDelivery = buildClaudeAuthDelivery(
      config.model?.auth,
      deliveryMode,
      configDir,
    );
    if (authDelivery.credentialsFile) {
      await mkdir(authDelivery.credentialsFile.dir, { recursive: true });
      await writeFile(
        authDelivery.credentialsFile.path,
        authDelivery.credentialsFile.contents,
        { mode: 0o600 },
      );
    }

    // Resolve an optional Claude Code resume reference. Only `claude_code`
    // refs apply here — a `pi` ref belongs to the PI engine and is ignored.
    const resume = config.session?.resume;
    const resumeSessionId =
      resume?.kind === "claude_code" ? resume.sessionId : undefined;

    // Dynamically import the SDK — fails gracefully at runtime if not installed.
    const sdk = (await import("@anthropic-ai/claude-agent-sdk").catch(
      () => null,
    )) as ClaudeAgentSdk | null;

    if (sdk) {
      const mcp = sdk.createSdkMcpServer({
        name: NEXUS_KERNEL_MCP_SERVER,
        version: "1.0.0",
        tools: sdkTools.map((t) =>
          sdk.tool(t.name, t.description, t.parameters, t.handler),
        ),
      });
      const authEnv = authDelivery.env;

      // Author contributions resolved for this session (empty when none). The
      // helper yields empty fragments for an empty bundle so the merge below is
      // a no-op — keeping the options byte-identical to the no-contribution
      // path. Author MCP tools still flow through `canUseTool`
      // (→ ctx.checkPermission), so contributions never widen the tool surface
      // past the profile ceiling.
      const contribution = deriveContributionQueryFragments(ctx.contributions);

      // Plugin materialization: stage plugin files under <agentDir>/plugins/
      // and get the `{ plugins:[...] }` option fragment (empty when no plugins).
      // Plugin MCP lives in staged `.mcp.json`, NOT in options.mcpServers.
      // Governance: all tools route through canUseTool → ctx.checkPermission.
      const staged = await stagePlugins(ctx.contributions, ctx.agentDir);
      // Surface any plugin drops so operators see potential-tampering signals.
      // Log id/kind/reason ONLY — never bundle bytes or resolved secrets.
      for (const drop of staged.dropped) {
        console.warn(
          `[claude-code-engine] harness_contribution_dropped id=${drop.id} kind=plugin reason=${drop.reason}`,
        );
      }

      const gen: AsyncIterable<unknown> = sdk.query({
        prompt: config.prompt.initialPrompt ?? config.prompt.systemPrompt,
        options: {
          cwd: ctx.workspacePath,
          systemPrompt: config.prompt.systemPrompt,
          disallowedTools: ["Task"],
          // `createSdkMcpServer` already returns a complete `{ type, name,
          // instance }` server config. The SDK extracts `entry.instance` once
          // and calls `instance.connect(transport)`, so it must be passed
          // verbatim — re-wrapping it makes the SDK call `.connect` on the
          // wrapper and throw "t.connect is not a function" (kanban-u4la).
          // Author MCP servers (extensions) are merged ALONGSIDE the kernel
          // server; their tools enter the same `canUseTool` gate below, so they
          // are governed (job ∩ profile) exactly like kernel tools.
          mcpServers: {
            [NEXUS_KERNEL_MCP_SERVER]: mcp,
            ...contribution.mcpServers,
          },
          pathToClaudeCodeExecutable: process.env["CLAUDE_CODE_BIN"],
          canUseTool,
          // The SDK REPLACES the subprocess environment with `env` rather than
          // merging it, so the container's PATH/HOME must be carried over
          // explicitly — otherwise the agent's Bash tool cannot resolve
          // ls/head/cat and every command exits 127 (kanban-nm7q). Author
          // settings.env is applied last as an additive patch.
          env: { ...process.env, ...authEnv, ...contribution.envPatch },
          // SDK option name is `resume` (a session UUID); omitted for a fresh
          // session so the SDK auto-generates a new id.
          ...(resumeSessionId ? { resume: resumeSessionId } : {}),
          // Author hooks / settings; plugin option `{plugins:[...]}` or `{}`.
          // All three are empty-no-op spreads when not authored/configured.
          ...contribution.optionalOptions,
          ...staged.pluginOption,
          abortController,
        },
      });
      sessionRef = new ClaudeCodeSession(gen, mapper, stepId, {
        resumable: resumeSessionId !== undefined,
        v3Sink,
        v3Mapper,
        onDispose: staged.dispose,
      });
      return sessionRef;
    }

    // SDK not installed — return a stub session that immediately emits an error result.
    const stub = (function* () {
      yield {
        type: "result",
        subtype: "error",
        result: "claude-agent-sdk not installed",
      };
    })() as unknown as AsyncIterable<unknown>;
    return new ClaudeCodeSession(stub, mapper, stepId, { v3Sink, v3Mapper });
  }
}

registerEngine("claude-code", () => new ClaudeCodeEngine());
