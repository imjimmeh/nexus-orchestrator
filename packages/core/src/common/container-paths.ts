/**
 * Container-internal filesystem paths shared between the API (which builds
 * container configs and bind-mounts host directories) and the harness runtime
 * (which reads from these paths inside the container).
 *
 * These MUST stay in sync: the API mounts governed tool extensions at
 * {@link CONTAINER_EXTENSIONS_PATH} and the runtime loads them from the same
 * path. Keeping a single source of truth prevents the mount target and the
 * runtime's read path from drifting apart (which silently strips an agent's
 * governed tools).
 */

/** Mount point for governed tool extension files inside execution containers. */
export const CONTAINER_EXTENSIONS_PATH = "/opt/pi-runner/extensions";

/**
 * Filename of the SDK coding-tool allowlist the API writes into the tool mount
 * (alongside the governed extensions) under {@link CONTAINER_EXTENSIONS_PATH}.
 *
 * It contains the policy-resolved subset of the harness's built-in coding tools
 * (read/write/edit/bash/ls/find/grep) plus their companions. Engines whose SDK
 * executes built-ins by name without a per-call governance hook (e.g. PI) MUST
 * read this file and filter their built-in tool set so workflow/profile
 * `tool_policy` is enforced; engines that govern every call via a permission
 * callback (e.g. claude-code) do not need it. When the file is absent, no
 * built-in coding-tool restriction applies.
 */
export const SDK_TOOL_ALLOWLIST_FILENAME = "_sdk_tool_allowlist.json";

/**
 * Agent working directory inside execution containers (created by the harness
 * Dockerfiles). The harness runtime writes the session JSONL under this dir.
 */
export const CONTAINER_AGENT_DIR = "/opt/harness-runtime/agent";

/**
 * Canonical session JSONL file path inside execution containers. The runtime
 * writes/opens the session here and the API extracts/injects it from the same
 * path, so it MUST equal `${CONTAINER_AGENT_DIR}/session.jsonl`.
 */
export const CONTAINER_SESSION_PATH = `${CONTAINER_AGENT_DIR}/session.jsonl`;

/**
 * Canonical checkpoint JSONL file path inside execution containers. The harness
 * {@link FileSidecarSink} appends one {@link SessionCheckpointMarker} line here
 * after each tool call when `SESSION_CHECKPOINT_PATH` is set in the container
 * environment. The API supervisor reads this file after container death to
 * persist the latest marker for resume on retry.
 *
 * MUST equal `${CONTAINER_AGENT_DIR}/checkpoints.jsonl` — lives alongside the
 * session file so a single parent-directory bind-mount covers both.
 */
export const CONTAINER_CHECKPOINT_PATH = `${CONTAINER_AGENT_DIR}/checkpoints.jsonl`;

/**
 * Default host-side base directory for per-execution checkpoint sidecars. Pinned
 * to `/tmp/nexus-checkpoints` so the path is deterministic on Linux containers
 * regardless of `os.tmpdir()` variance. This MUST match the container-side mount
 * target in `docker-compose.yaml`.
 *
 * Override at runtime with the `NEXUS_CHECKPOINT_BASE_DIR` environment variable.
 * Individual sidecar directories are nested as `<base>/<workflowRunId>/<jobId>/`.
 */
export const DEFAULT_CHECKPOINT_BASE_DIR = "/tmp/nexus-checkpoints";
