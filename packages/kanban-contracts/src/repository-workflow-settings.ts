import type {
  RepositoryIntegrationSettings,
  RepositoryIntegrationStrategy,
  RepositoryMergeMethod,
  RepositoryWorkflowOverride,
  RepositoryWorkflowSettings,
} from "./repository-workflow-settings.types";

const DEFAULT_INTEGRATION: Required<RepositoryIntegrationSettings> = {
  strategy: "direct-push",
  mergeMethod: "merge",
  autoMerge: false,
  preflightGate: true,
};

const VALID_STRATEGIES: ReadonlySet<RepositoryIntegrationStrategy> = new Set([
  "direct-push",
  "pull-request",
]);
const VALID_MERGE_METHODS: ReadonlySet<RepositoryMergeMethod> = new Set([
  "merge",
  "squash",
  "rebase",
]);

/**
 * Normalize a persisted (possibly absent or malformed) repository workflow
 * settings blob into a fully-resolved {@link RepositoryWorkflowSettings}.
 *
 * Repository lifecycle gates default to ON: a project with no persisted
 * settings is treated as enabled. This is the single source of truth shared by
 * the settings read path and the transition gate so the UI and the gate can
 * never disagree on what an absent value means.
 */
export function resolveRepositoryWorkflowSettings(
  raw: Record<string, unknown> | null | undefined,
): RepositoryWorkflowSettings {
  if (!raw || typeof raw !== "object") {
    return { enabled: true, overrides: {} };
  }

  const base: RepositoryWorkflowSettings = {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    overrides: resolveOverridesMap(raw.overrides),
  };

  if ("integration" in raw && raw.integration != null) {
    base.integration = resolveRepositoryIntegrationSettings(raw);
  }

  return base;
}

function resolveOverridesMap(
  raw: unknown,
): Record<string, RepositoryWorkflowOverride> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const map: Record<string, RepositoryWorkflowOverride> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).enabled === "boolean"
    ) {
      map[key] = { enabled: (value as { enabled: boolean }).enabled };
    }
  }

  return map;
}

/**
 * Normalize a persisted (possibly absent or malformed) integration sub-object
 * into a fully-defaulted {@link RepositoryIntegrationSettings}. Defaults to the
 * direct-push strategy so an absent or unparseable value never changes merge
 * behaviour. Never throws.
 */
export function resolveRepositoryIntegrationSettings(
  settings: Record<string, unknown> | null | undefined,
): Required<RepositoryIntegrationSettings> {
  const raw =
    settings && typeof settings === "object"
      ? (settings.integration as Record<string, unknown> | undefined)
      : undefined;

  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_INTEGRATION };
  }

  return {
    strategy:
      typeof raw.strategy === "string" &&
      VALID_STRATEGIES.has(raw.strategy as RepositoryIntegrationStrategy)
        ? (raw.strategy as RepositoryIntegrationStrategy)
        : DEFAULT_INTEGRATION.strategy,
    mergeMethod:
      typeof raw.mergeMethod === "string" &&
      VALID_MERGE_METHODS.has(raw.mergeMethod as RepositoryMergeMethod)
        ? (raw.mergeMethod as RepositoryMergeMethod)
        : DEFAULT_INTEGRATION.mergeMethod,
    autoMerge:
      typeof raw.autoMerge === "boolean"
        ? raw.autoMerge
        : DEFAULT_INTEGRATION.autoMerge,
    preflightGate:
      typeof raw.preflightGate === "boolean"
        ? raw.preflightGate
        : DEFAULT_INTEGRATION.preflightGate,
  };
}
