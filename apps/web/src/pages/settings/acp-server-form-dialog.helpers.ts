import { AcpAuthType } from "@/lib/api/acp.types";
import { AcpServer, CreateAcpServerRequest } from "@/lib/api/acp.types";
import { AcpAwaitPolicy, AcpRunMode } from "@/lib/api/acp.types";
import type {
  AcpServerFormValues,
  SetFormValues,
} from "./acp-server-form-dialog.types";

export const DEFAULT_FORM_VALUES: AcpServerFormValues = {
  name: "",
  enabled: true,
  url: "",
  auth_type: AcpAuthType.NONE,
  auth_token: "",
  headersJson: "",
  includeAgents: "",
  excludeAgents: "",
  timeoutMs: "30000",
  connectTimeoutMs: "10000",
  maxRetries: "2",
  retryBackoffMs: "1000",
  default_run_mode: "sync" as AcpRunMode,
  await_policy: "surface-to-user" as AcpAwaitPolicy,
};

export function setFormField<K extends keyof AcpServerFormValues>(
  setFormValues: SetFormValues,
  key: K,
  value: AcpServerFormValues[K],
): void {
  setFormValues((previous) => ({
    ...previous,
    [key]: value,
  }));
}

function parseList(raw: string): string[] | undefined {
  const values = raw
    .split(/[\n,]/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : undefined;
}

function parseOptionalInt(raw: string): number | undefined {
  const value = raw.trim();
  if (value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${raw}`);
  }

  return parsed;
}

function stringifyHeaders(headers?: Record<string, string> | null): string {
  if (!headers || Object.keys(headers).length === 0) {
    return "";
  }

  return JSON.stringify(headers, null, 2);
}

function parseHeadersJson(raw: string): Record<string, string> | undefined {
  const value = raw.trim();
  if (value.length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Headers must be a JSON object");
  }

  const normalized: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(parsed)) {
    if (typeof candidate !== "string") {
      throw new Error(`Header '${key}' must be a string`);
    }
    normalized[key] = candidate;
  }

  return normalized;
}

export function toFormValues(server: AcpServer | null): AcpServerFormValues {
  if (!server) {
    return DEFAULT_FORM_VALUES;
  }

  return {
    name: server.name,
    enabled: server.enabled,
    url: server.url,
    auth_type: server.auth_type,
    auth_token: server.auth_token ?? "",
    headersJson: stringifyHeaders(server.headers),
    includeAgents: (server.include_agents ?? []).join(", "),
    excludeAgents: (server.exclude_agents ?? []).join(", "),
    timeoutMs: String(server.timeout_ms),
    connectTimeoutMs: String(server.connect_timeout_ms),
    maxRetries: String(server.max_retries),
    retryBackoffMs: String(server.retry_backoff_ms),
    default_run_mode: server.default_run_mode,
    await_policy: server.await_policy,
  };
}

export function buildRequestPayload(
  form: AcpServerFormValues,
): CreateAcpServerRequest {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    url: form.url.trim(),
    auth_type: form.auth_type,
    auth_token: form.auth_token.trim() || undefined,
    headers: parseHeadersJson(form.headersJson),
    include_agents: parseList(form.includeAgents),
    exclude_agents: parseList(form.excludeAgents),
    timeout_ms: parseOptionalInt(form.timeoutMs),
    connect_timeout_ms: parseOptionalInt(form.connectTimeoutMs),
    max_retries: parseOptionalInt(form.maxRetries),
    retry_backoff_ms: parseOptionalInt(form.retryBackoffMs),
    default_run_mode: form.default_run_mode,
    await_policy: form.await_policy,
  };
}
