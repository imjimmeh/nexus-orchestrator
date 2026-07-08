/**
 * PiEngine — HarnessEngine implementation backed by the pi-coding-agent SDK.
 *
 * Ports the session-factory logic from pi-runner into the harness-runtime
 * kernel boundary so that it can be loaded as a self-registering engine module.
 */

import * as fs from "node:fs";
import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import type {
  HarnessCapabilities,
  HarnessContributions,
  HarnessRuntimeConfig,
  RunnerOAuthCredential,
  RunnerOAuthRefreshConfig,
  RunnerProviderRegistrationConfig,
} from "@nexus/core";
import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  PI_CAPABILITIES,
  SDK_TOOL_ALLOWLIST_FILENAME,
} from "@nexus/core";
import type {
  HarnessEngine,
  HarnessSessionContext,
  HookMaterializer,
  ExtensionMaterializer,
  ValidationResult,
} from "@nexus/harness-runtime";
import { registerEngine } from "@nexus/harness-runtime";
import { PiHarnessSession } from "./pi-harness-session.js";
import { bridgeMcpServersToGovernedTools } from "./contribution-mcp-bridge.js";
import {
  convertGovernedTools,
  convertBridgedTools,
  dedupeTools,
  writeHookExtensionFile,
} from "./contribution-tool-adapter.js";
import { stageHookScripts } from "./contribution-asset-staging.js";
import {
  stageExtensionAssetsWithDiagnostics,
  cleanupStagedExtensions,
} from "./contribution-extension-staging.js";

// ---------------------------------------------------------------------------
// Internal constants mirrored from session-factory.ts
// ---------------------------------------------------------------------------

const CUSTOM_MODEL_CONTEXT_WINDOW = 128000;
const CUSTOM_MODEL_MAX_TOKENS = 16384;
const OPENAI_COMPAT_RUNTIME_PROVIDER = "openai";

/** Filename of the generated hook extension module (a `.ts` so the loader picks it up). */
const NEXUS_HOOK_EXTENSION_FILENAME = "nexus-contributed-hooks.ts";

type AgentSessionModel = NonNullable<
  NonNullable<Parameters<typeof createAgentSession>[0]>["model"]
>;
type AgentSessionInstance = Awaited<
  ReturnType<typeof createAgentSession>
>["session"];
type ModelRegistryInstance = ReturnType<typeof ModelRegistry.inMemory>;
type ProviderConfigInput = Parameters<
  ModelRegistryInstance["registerProvider"]
>[1];

// ---------------------------------------------------------------------------
// PiEngine
// ---------------------------------------------------------------------------

export class PiEngine
  implements HarnessEngine, HookMaterializer, ExtensionMaterializer
{
  readonly id = "pi" as const;
  readonly capabilities: HarnessCapabilities = PI_CAPABILITIES;

  /**
   * Materializer SPI conformance. The real materialization happens inside
   * {@link createSession} (it must run before the resource loader scans the
   * extensions dir and before `createAgentSession` receives the tool set), so
   * these methods are idempotent no-ops that simply satisfy the capability ⇒
   * interface contract enforced by `applyContributions`.
   */
  async materializeHooks(): Promise<void> {
    // Handled in createSession via ctx.contributions.
  }

  async materializeExtensions(): Promise<void> {
    // Handled in createSession via ctx.contributions.
  }

  validate(config: HarnessRuntimeConfig): ValidationResult {
    if (!config.model?.provider) {
      return { ok: false, errors: ["model.provider is required"] };
    }
    if (!config.model?.model) {
      return { ok: false, errors: ["model.model is required"] };
    }
    if (!config.model?.auth) {
      return { ok: false, errors: ["model.auth is required"] };
    }
    return { ok: true };
  }

  async createSession(
    config: HarnessRuntimeConfig,
    ctx: HarnessSessionContext,
  ): Promise<PiHarnessSession> {
    const runtimeProvider = resolveRuntimeProvider(config);

    // 1. Auth — inject credentials received over runtime config transport
    const authStorage = AuthStorage.inMemory(
      config.model.auth.type === "oauth"
        ? {
            [runtimeProvider]: toUpstreamOAuthCredential(
              config.model.auth.credential,
            ),
          }
        : undefined,
    );

    if (config.model.auth.type === "api_key") {
      authStorage.setRuntimeApiKey(runtimeProvider, config.model.auth.apiKey);
    }

    // 2. Model resolution
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    const registrationConfig = buildProviderConfigInput(
      config.model.providerConfig ??
        (config.model.baseUrl ? { baseUrl: config.model.baseUrl } : undefined),
    );
    if (registrationConfig) {
      modelRegistry.registerProvider(runtimeProvider, registrationConfig);
    }

    const customModel = shouldCreateLegacyCustomModel(config)
      ? createCustomModel(config.model, runtimeProvider)
      : undefined;
    const model =
      customModel ?? modelRegistry.find(runtimeProvider, config.model.model);
    if (!model) {
      const available = modelRegistry
        .getAll()
        .map((m) => `${(m as { provider?: string }).provider ?? ""}/${m.id}`)
        .join(", ");
      throw new Error(
        `Model not found: ${runtimeProvider}/${config.model.model}. Available: ${available}`,
      );
    }

    // 3. Session manager — open existing JSONL or start fresh
    const sessionManager = buildSessionManager(ctx, config);

    // 4. Settings — in-memory
    const settingsManager = SettingsManager.inMemory();

    // Durable agent-await: when a governed tool returns `terminate` (the
    // runner's translation of an API executionStatus:"suspended" directive for
    // await_agent_workflow / delegate_*) the engine aborts the in-flight pi run
    // so the SDK issues no further LLM turn, and marks the harness session
    // suspended so it emits a clean suspended agent_end that parks the run for
    // durable resume. Without this the pi SDK keeps the turn going and the agent
    // re-calls await_agent_workflow in a loop. See kanban-atuq.
    // A const holder lets `onTerminate` close over references that are not
    // populated until the session is created further down.
    const sessionRefs: {
      harness?: PiHarnessSession;
      agent?: AgentSessionInstance;
    } = {};
    const onTerminate = (): void => {
      sessionRefs.harness?.suspend();
      void sessionRefs.agent?.abort();
    };

    // 5. Convert governed tools (already wrapped by kernel) to PI ToolDefinitions.
    //    This must happen before building the resource loader so the system prompt
    //    can be rewritten with provider-safe tool names.
    const { piTools: governedPiTools, sanitizedToOriginal } =
      convertGovernedTools(ctx.governedTools, onTerminate);

    // 5a–c. Stage contributions into extensionsPath BEFORE resolveExtensionPaths.
    const contributions = ctx.contributions ?? EMPTY_HARNESS_CONTRIBUTIONS;
    const { stagedHooks, stagedExtensions } = stageContributions(
      ctx.extensionsPath,
      contributions,
    );

    // 6. Resource loader
    const extensionPaths = resolveExtensionPaths(ctx.extensionsPath);
    const cwd = ctx.workspacePath;
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: ctx.agentDir,
      settingsManager,
      additionalExtensionPaths: extensionPaths,
      systemPrompt: sanitizeSystemPrompt(
        config.prompt.systemPrompt,
        sanitizedToOriginal,
      ),
    });
    await resourceLoader.reload();

    // 7. SDK coding tools (built-ins). The PI SDK executes these by name without
    //    a per-call governance hook, so we enforce the workflow/profile policy
    //    here by filtering against the API-written allowlist. Governed tools are
    //    already policy-filtered upstream and are never touched by this list.
    const builtInTools = filterBuiltInToolsByAllowlist(
      dedupeTools([
        ...createCodingTools(cwd),
        ...createReadOnlyTools(cwd),
      ]) as ToolDefinition[],
      readSdkToolAllowlist(ctx.extensionsPath),
    );

    // 7a. Bridge resolved MCP server descriptors into governed PI tools.
    //     PI has no native MCP client; each server is connected engine-side.
    const bridged = await bridgeMcpServersToGovernedTools(
      contributions.resolvedMcpServers ?? [],
      (toolName, params) => ctx.checkPermission(toolName, params),
    );
    const bridgedPiTools = convertBridgedTools(bridged.tools);

    const customTools = [...governedPiTools, ...bridgedPiTools];
    const allTools = dedupeTools([...builtInTools, ...customTools]);

    const { session } = await createAgentSession({
      cwd,
      agentDir: ctx.agentDir,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: config.model.thinkingLevel,
      tools: allTools.map((tool) => tool.name),
      customTools,
      sessionManager,
      settingsManager,
      resourceLoader,
    });

    sessionRefs.agent = session;

    // stepId: use the step identifier from harnessOptions when provided,
    // falling back to "session" so canonical events are always tagged.
    const stepId =
      typeof config.harnessOptions?.stepId === "string"
        ? config.harnessOptions.stepId
        : "session";

    const harnessSession = new PiHarnessSession(
      session,
      stepId,
      sanitizedToOriginal,
      async () => {
        await bridged.dispose();
        cleanupStagedHooks(stagedHooks);
        cleanupStagedExtensions(stagedExtensions);
      },
    );
    sessionRefs.harness = harnessSession;
    return harnessSession;
  }
}

// ---------------------------------------------------------------------------
// Provider-facing tool name constraints
// ---------------------------------------------------------------------------

function sanitizeSystemPrompt(
  prompt: string,
  sanitizedToOriginal: Map<string, string>,
): string {
  let sanitized = prompt;
  for (const [sanitizedName, originalName] of sanitizedToOriginal) {
    if (sanitizedName === originalName) continue;
    sanitized = sanitized.split(originalName).join(sanitizedName);
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Provider helpers (ported from pi-runner/session-factory.ts)
// ---------------------------------------------------------------------------

function resolveRuntimeProvider(config: HarnessRuntimeConfig): string {
  if (
    config.model.auth.type === "oauth" ||
    config.model.providerConfig?.oauth
  ) {
    return config.model.provider;
  }
  if (config.model.baseUrl) {
    return OPENAI_COMPAT_RUNTIME_PROVIDER;
  }
  return config.model.provider;
}

function shouldCreateLegacyCustomModel(config: HarnessRuntimeConfig): boolean {
  return (
    config.model.auth.type === "api_key" &&
    Boolean(config.model.baseUrl) &&
    !config.model.providerConfig?.models
  );
}

function createCustomModel(
  modelConfig: HarnessRuntimeConfig["model"],
  runtimeProvider: string,
): AgentSessionModel | undefined {
  if (!modelConfig.baseUrl) return undefined;
  return {
    id: modelConfig.model,
    name: modelConfig.model,
    api: "openai-completions",
    // Must match the provider the API key was registered under
    // (resolveRuntimeProvider), not the raw DB provider name — the SDK resolves
    // the key by `model.provider`.
    provider: runtimeProvider,
    baseUrl: modelConfig.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens: CUSTOM_MODEL_MAX_TOKENS,
  } satisfies AgentSessionModel;
}

function buildSessionManager(
  ctx: HarnessSessionContext,
  config: HarnessRuntimeConfig,
): SessionManager {
  const agentDir = ctx.agentDir;

  if (fs.existsSync(ctx.sessionPath)) {
    const sm = SessionManager.open(ctx.sessionPath, agentDir);
    if (config.session?.resumeNodeId) {
      sm.branch(config.session.resumeNodeId);
    }
    skipTrailingAssistantLeaf(sm);
    return sm;
  }

  return SessionManager.create(ctx.workspacePath, agentDir);
}

/**
 * Ensure a resumed session does not end on an assistant turn.
 *
 * pi-agent-core's `agentLoopContinue` refuses to resume a context whose last
 * message is an assistant turn, throwing "Cannot continue from message role:
 * assistant". The runner reports that as `agent_error`, the API misclassifies it
 * as a generic failure and reschedules the whole step, so the run loops until it
 * exhausts its retries.
 *
 * Two paths leave an assistant leaf on resume:
 *   - A durable-await suspend aborts the in-flight turn; the pi SDK persists a
 *     final AssistantMessage with stopReason "aborted"/"error" (often empty
 *     content) — see kanban-1fbn.
 *   - A spurious re-dispatch resumes a job that already finished a turn, whose
 *     leaf is a completed ("end_turn") or tool-requesting ("toolUse") assistant
 *     turn — see runs 0de65a08 / f0b9b05b.
 *
 * Neither leaf is resumable, so branch back to the leaf's parent — the last
 * tool_result / user entry — and let the model continue (or re-prompt) from
 * there. Non-assistant leaves and root-level assistant turns (no parent) are
 * left untouched.
 */
function skipTrailingAssistantLeaf(sm: SessionManager): void {
  if (typeof sm.getLeafEntry !== "function") return;
  const leaf = sm.getLeafEntry();
  const parentId = trailingAssistantParentId(leaf);
  if (parentId) {
    sm.branch(parentId);
  }
}

/**
 * Returns the parent entry id of `leaf` when it is an assistant turn with a
 * parent to branch back to; otherwise `undefined`.
 */
function trailingAssistantParentId(leaf: unknown): string | undefined {
  if (!leaf || typeof leaf !== "object") return undefined;

  const entry = leaf as {
    type?: unknown;
    parentId?: unknown;
    message?: unknown;
  };
  if (entry.type !== "message") return undefined;
  if (typeof entry.parentId !== "string" || entry.parentId.length === 0) {
    return undefined;
  }

  const message = entry.message as { role?: unknown } | undefined;
  if (!message || message.role !== "assistant") return undefined;

  return entry.parentId;
}

/**
 * Remove each staged hook script file on session dispose (best-effort).
 * Files that have already been deleted (or were never written) are silently
 * ignored so cleanup never throws.
 */
function cleanupStagedHooks(staged: ReadonlyMap<string, string>): void {
  for (const filePath of staged.values()) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup — ignore missing-file or permission errors.
    }
  }
}

/**
 * Stage all contributed assets into `extensionsPath` before the PI resource
 * loader scans the directory. Returns the staged collections for cleanup on
 * session dispose.
 *
 * Any extension that fails the defense-in-depth re-verify guard (missing
 * bundle or checksum mismatch) is logged at WARN with id/kind/reason only —
 * never bundle bytes or secrets. This surfaces potential-tampering signals that
 * would otherwise be silently discarded.
 */
function stageContributions(
  extensionsPath: string,
  contributions: HarnessContributions,
): {
  stagedHooks: Map<string, string>;
  stagedExtensions: string[];
} {
  const stagedHooks = stageHookScripts(extensionsPath, contributions.hooks);
  writeHookExtensionFile(
    extensionsPath,
    NEXUS_HOOK_EXTENSION_FILENAME,
    contributions.hooks,
    stagedHooks,
  );
  const { stagedPaths, dropped } = stageExtensionAssetsWithDiagnostics(
    extensionsPath,
    contributions.extensions,
  );
  for (const drop of dropped) {
    console.warn(
      `[pi-engine] harness_contribution_dropped id=${drop.id} kind=extension reason=${drop.reason}`,
    );
  }
  return { stagedHooks, stagedExtensions: stagedPaths };
}

function resolveExtensionPaths(extensionsDir: string): string[] {
  if (!fs.existsSync(extensionsDir)) return [];
  return fs
    .readdirSync(extensionsDir)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .map((file) => `${extensionsDir}/${file}`);
}

/**
 * Read the API-written SDK coding-tool allowlist from the tool mount. Returns
 * the allowed tool names, or `null` when the file is absent or unreadable —
 * `null` means "no built-in restriction" (back-compat), distinct from an empty
 * array which denies every built-in tool.
 */
function readSdkToolAllowlist(extensionsDir: string): string[] | null {
  const filePath = `${extensionsDir}/${SDK_TOOL_ALLOWLIST_FILENAME}`;
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((name): name is string => typeof name === "string");
  } catch {
    return null;
  }
}

/**
 * Restrict built-in SDK coding tools to the allowlist. A `null` allowlist (no
 * file) leaves the built-ins untouched.
 */
function filterBuiltInToolsByAllowlist(
  builtInTools: ToolDefinition[],
  allowlist: string[] | null,
): ToolDefinition[] {
  if (allowlist === null) return builtInTools;
  const allowed = new Set(allowlist);
  return builtInTools.filter((tool) => allowed.has(tool.name));
}

// ---------------------------------------------------------------------------
// OAuth helpers (ported from pi-runner/runner-oauth-provider-config.ts)
// ---------------------------------------------------------------------------

function toUpstreamOAuthCredential(
  credential: RunnerOAuthCredential,
): { type: "oauth" } & OAuthCredentials {
  return {
    type: "oauth",
    refresh: credential.refreshToken,
    access: credential.accessToken,
    expires: credential.expiresAt,
  };
}

function buildProviderConfigInput(
  providerConfig: RunnerProviderRegistrationConfig | undefined,
): ProviderConfigInput | undefined {
  if (!providerConfig) return undefined;

  const oauthConfig = providerConfig.oauth;

  return removeUndefined({
    name: providerConfig.name,
    baseUrl: providerConfig.baseUrl,
    api: providerConfig.api,
    headers: providerConfig.headers,
    authHeader: providerConfig.authHeader,
    models: providerConfig.models?.map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api,
      baseUrl: m.baseUrl,
      reasoning: m.reasoning,
      thinkingLevelMap: m.thinkingLevelMap,
      input: m.input,
      cost: m.cost,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      headers: m.headers,
    })),
    oauth: oauthConfig
      ? {
          name: oauthConfig.name,
          login: () =>
            Promise.reject(
              new Error("OAuth login is not supported inside Nexus runner"),
            ),
          refreshToken: (credentials: OAuthCredentials) =>
            refreshOAuthCredentials(oauthConfig.refresh, credentials),
          getApiKey: (credentials: OAuthCredentials) => credentials.access,
        }
      : undefined,
  });
}

async function refreshOAuthCredentials(
  config: RunnerOAuthRefreshConfig,
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const body: Record<string, unknown> = {
    ...(config.body ?? {}),
    [config.refreshTokenParam ?? "refresh_token"]: credentials.refresh,
  };

  const response = await fetch(config.tokenUrl, {
    method: config.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.headers ?? {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `OAuth refresh failed with HTTP ${response.status.toString()}`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const access = readStringPath(
    payload,
    config.accessTokenPath ?? "access_token",
  );
  if (!access) {
    throw new Error("OAuth refresh response is missing access token");
  }

  return {
    access,
    refresh:
      readStringPath(payload, config.refreshTokenPath ?? "refresh_token") ??
      credentials.refresh,
    expires: resolveExpiresAt(payload, config),
  };
}

function resolveExpiresAt(
  payload: Record<string, unknown>,
  config: RunnerOAuthRefreshConfig,
): number {
  const expiresAt = config.expiresAtPath
    ? readNumberPath(payload, config.expiresAtPath)
    : undefined;
  if (expiresAt !== undefined) return expiresAt;

  const expiresIn = readNumberPath(
    payload,
    config.expiresInPath ?? "expires_in",
  );
  if (expiresIn === undefined) {
    throw new Error("OAuth refresh response is missing expiration");
  }
  return Date.now() + expiresIn * 1000;
}

function readStringPath(
  source: Record<string, unknown>,
  path: string,
): string | undefined {
  const value = readPath(source, path);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumberPath(
  source: Record<string, unknown>,
  path: string,
): number | undefined {
  const value = readPath(source, path);
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

registerEngine("pi", () => new PiEngine());
