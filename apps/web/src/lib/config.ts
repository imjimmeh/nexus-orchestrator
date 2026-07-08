// Runtime configuration loaded from config.json
import type {
  ResolvedRuntimeConfig,
  RuntimeConfig,
  RuntimeServiceTarget,
} from "./config.types";

export type { RuntimeConfig } from "./config.types";
export type {
  ResolvedRuntimeConfig,
  RuntimeServiceTarget,
} from "./config.types";

type RuntimeRequestMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "head"
  | "options"
  | undefined;

const DEFAULT_API_URL = "/api";
const CHAT_ROUTE_PREFIXES = ["/sessions/chat"];
const CORE_ROUTE_PREFIXES = [
  "/admin",
  "/ai-config",
  "/auth",
  "/events",
  "/mcp",
  "/acp",
  "/models",
  "/notifications",
  "/operations",
  "/providers",
  "/secrets",
  "/setup",
  "/tool-approval-rules",
  "/tool-call-approval-requests",
  "/tools",
  "/users",
  "/workflow-runtime",
  "/workflows",
];
const KANBAN_ROUTE_PREFIXES = [
  "/orchestration",
  "/projects",
  "/work-items",
  "/kanban-settings",
];

let runtimeConfig: ResolvedRuntimeConfig | null = null;

export function setRuntimeConfig(config: ResolvedRuntimeConfig): void {
  runtimeConfig = config;
}
const RUNTIME_CONFIG_EVENT = "runtime-config:load";

function publishRuntimeConfigNotice(
  level: "info" | "warn",
  message: string,
  details?: unknown,
): void {
  if (globalThis.window === undefined) {
    return;
  }

  globalThis.dispatchEvent(
    new CustomEvent(RUNTIME_CONFIG_EVENT, {
      detail: { level, message, details },
    }),
  );
}

export async function loadRuntimeConfig(): Promise<ResolvedRuntimeConfig> {
  if (runtimeConfig) {
    return runtimeConfig;
  }

  try {
    const response = await fetch("/config.json");
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status}`);
    }
    const config = resolveRuntimeConfig(
      (await response.json()) as RuntimeConfig,
    );
    runtimeConfig = config;
    publishRuntimeConfigNotice("info", "Runtime config loaded", runtimeConfig);
    return config;
  } catch (error) {
    publishRuntimeConfigNotice(
      "warn",
      "Failed to load runtime config, using defaults",
      error,
    );
    const fallbackConfig = resolveRuntimeConfig(undefined);
    runtimeConfig = fallbackConfig;
    return fallbackConfig;
  }
}

export function getRuntimeConfig(): ResolvedRuntimeConfig {
  if (!runtimeConfig) {
    throw new Error(
      "Runtime config not loaded. Call loadRuntimeConfig() first.",
    );
  }
  return runtimeConfig;
}

export function resolveRuntimeConfig(
  config: RuntimeConfig | null | undefined,
): ResolvedRuntimeConfig {
  const apiUrl = normalizeUrl(config?.apiUrl, DEFAULT_API_URL);

  return {
    apiUrl,
    coreApiUrl: normalizeUrl(config?.coreApiUrl, apiUrl),
    kanbanApiUrl: normalizeUrl(config?.kanbanApiUrl, apiUrl),
    chatApiUrl: normalizeUrl(config?.chatApiUrl, apiUrl),
  };
}

export function resolveRuntimeServiceTarget(
  requestPath: string | undefined,
  _requestMethod?: RuntimeRequestMethod,
): RuntimeServiceTarget {
  if (!requestPath) {
    return "core";
  }

  const pathWithoutQuery = stripQueryAndHash(requestPath);
  const normalizedPath = pathWithoutQuery.startsWith("/")
    ? pathWithoutQuery
    : `/${pathWithoutQuery}`;

  if (isCoreOwnedProjectCollaborationRoute(normalizedPath)) {
    return "core";
  }

  if (isCoreOwnedSessionRoute(normalizedPath)) {
    return "core";
  }

  if (hasRoutePrefix(normalizedPath, CHAT_ROUTE_PREFIXES)) {
    return "chat";
  }

  if (hasRoutePrefix(normalizedPath, KANBAN_ROUTE_PREFIXES)) {
    return "kanban";
  }

  if (hasRoutePrefix(normalizedPath, CORE_ROUTE_PREFIXES)) {
    return "core";
  }

  return "core";
}

function stripQueryAndHash(requestPath: string): string {
  return requestPath.split(/[?#]/, 1)[0];
}

function isCoreOwnedProjectCollaborationRoute(normalizedPath: string): boolean {
  return normalizedPath.includes("/orchestration/war-room");
}

export function resolveRuntimeServiceBaseUrl(
  config: ResolvedRuntimeConfig,
  service: RuntimeServiceTarget,
): string {
  if (service === "kanban") {
    return config.kanbanApiUrl;
  }

  if (service === "chat") {
    return config.chatApiUrl;
  }

  return config.coreApiUrl;
}

export function resolveRuntimeBaseUrlForPath(
  config: ResolvedRuntimeConfig,
  requestPath: string | undefined,
  requestMethod?: RuntimeRequestMethod,
): string {
  return resolveRuntimeServiceBaseUrl(
    config,
    resolveRuntimeServiceTarget(requestPath, requestMethod),
  );
}

function hasRoutePrefix(
  requestPath: string,
  prefixes: readonly string[],
): boolean {
  const normalized = requestPath.startsWith("/")
    ? requestPath
    : `/${requestPath}`;

  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function isCoreOwnedSessionRoute(normalizedPath: string): boolean {
  return (
    normalizedPath.startsWith("/sessions") &&
    !normalizedPath.startsWith("/sessions/chat")
  );
}

function normalizeUrl(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
