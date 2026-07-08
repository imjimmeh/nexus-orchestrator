import type { HarnessHookAsset, HarnessHookEvent } from '@nexus/core';
import type { FetchedFile } from './asset-importer.service.types.js';

export type { VettingResult, VettingError } from './asset-vetting.types.js';
import type { VettingResult, VettingError } from './asset-vetting.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum total byte size of all fetched file contents combined. */
export const DEFAULT_SIZE_CAP_BYTES = 5 * 1024 * 1024; // 5 MiB

const CC_MANIFEST_PATH = '.claude-plugin/plugin.json';
const CC_HOOKS_PATH = 'hooks/hooks.json';
const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Inverse of `SDK_HOOK_EVENT_BY_NEUTRAL` from `plugin-sdk-mappers.ts`.
 *
 * Maps each Claude Code SDK hook event name back to the neutral
 * `HarnessHookEvent` so that imported plugin hooks can be stored in the
 * canonical neutral form and re-emitted by Phase-3 staging.
 */
const NEUTRAL_EVENT_BY_SDK: Readonly<Record<string, HarnessHookEvent>> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  UserPromptSubmit: 'user_prompt_submit',
};

/**
 * v1 unsupported CC plugin component directories / files.
 *
 * - `commands/` — slash-command scripts (no authoring model in v1).
 * - `agents/` — sub-agent definitions (no authoring model in v1).
 * - `skills/` — skill YAML definitions (no authoring model in v1).
 * - `.mcp.json` — inline MCP server definitions; v1 uses `mcpServerRefs` into
 *   the API MCP runtime instead, so an inline `.mcp.json` in an imported plugin
 *   cannot be faithfully mapped.
 */
const UNSUPPORTED_CC_COMPONENT_MARKERS: ReadonlyArray<{
  prefix: string;
  label: string;
}> = [
  { prefix: 'commands/', label: 'commands/' },
  { prefix: 'agents/', label: 'agents/' },
  { prefix: 'skills/', label: 'skills/' },
  { prefix: '.mcp.json', label: '.mcp.json' },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function totalBytes(files: FetchedFile[]): number {
  return files.reduce(
    (sum, f) => sum + Buffer.byteLength(f.contents, 'utf8'),
    0,
  );
}

function findFile(
  files: FetchedFile[],
  relativePath: string,
): FetchedFile | undefined {
  return files.find((f) => f.path === relativePath);
}

// ---------------------------------------------------------------------------
// CC Plugin vetting
// ---------------------------------------------------------------------------

/**
 * Vets a CC plugin fetch result.
 *
 * Validates:
 * - Presence and parseability of `.claude-plugin/plugin.json`.
 * - `name` field is present and matches kebab-case.
 * - Unknown manifest keys are tolerated (passed through).
 * - `hooks/hooks.json`, when present, is parsed and mapped to neutral
 *   `HarnessHookAsset[]` for faithful storage and re-emission by Phase-3 staging.
 *
 * v1 constraints:
 * - A single plugin root per import (no marketplace multi-plugin repos). Reject
 *   if a `.claude-plugin/marketplace.json` is present.
 * - Components that v1 cannot faithfully map (`commands/`, `agents/`, `skills/`,
 *   `.mcp.json`) cause an explicit rejection so the operator gets an honest error
 *   rather than a silent green-but-inert import.
 *
 * Returns `hooks` in the result value so the importer can merge them into the
 * persisted bundle's `capabilities.hooks`.
 */
export function vetCcPlugin(files: FetchedFile[]): VettingResult<{
  name: string;
  manifest: Record<string, unknown>;
  hooks: HarnessHookAsset[];
}> {
  const manifestFile = findFile(files, CC_MANIFEST_PATH);
  if (!manifestFile) {
    const error: VettingError = {
      code: 'cc_manifest_missing',
      message: `Missing required file: ${CC_MANIFEST_PATH}`,
    };
    return { ok: false, error };
  }

  // Reject marketplace imports (v1: single plugin per import).
  if (findFile(files, '.claude-plugin/marketplace.json')) {
    const error: VettingError = {
      code: 'cc_marketplace_rejected',
      message:
        'Marketplace imports are not supported in v1 — import each plugin separately',
    };
    return { ok: false, error };
  }

  // v1 boundary: reject unsupported components before spending time parsing JSON.
  for (const { prefix, label } of UNSUPPORTED_CC_COMPONENT_MARKERS) {
    const has = files.some(
      (f) => f.path === prefix || f.path.startsWith(prefix),
    );
    if (has) {
      const error: VettingError = {
        code: 'cc_unsupported_component',
        message: `imported plugin component not supported in v1: ${label}`,
      };
      return { ok: false, error };
    }
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestFile.contents) as Record<string, unknown>;
  } catch {
    const error: VettingError = {
      code: 'cc_manifest_invalid_json',
      message: `${CC_MANIFEST_PATH} is not valid JSON`,
    };
    return { ok: false, error };
  }

  const name = manifest['name'];
  if (typeof name !== 'string' || name.length === 0) {
    const error: VettingError = {
      code: 'cc_manifest_name_missing',
      message: `${CC_MANIFEST_PATH}: required field 'name' is missing or empty`,
    };
    return { ok: false, error };
  }

  if (!KEBAB_CASE_RE.test(name)) {
    const error: VettingError = {
      code: 'cc_manifest_name_invalid',
      message: `${CC_MANIFEST_PATH}: 'name' must be kebab-case (got: ${name})`,
    };
    return { ok: false, error };
  }

  // Parse hooks/hooks.json when present; map SDK events back to neutral events.
  const hooksResult = parseHooksJson(files);
  if (!hooksResult.ok) {
    return { ok: false, error: hooksResult.error };
  }

  return { ok: true, value: { name, manifest, hooks: hooksResult.value } };
}

// ---------------------------------------------------------------------------
// Internal: hooks/hooks.json parser
// ---------------------------------------------------------------------------

/**
 * Shape of a single entry inside a `hooks/hooks.json` SDK hooks event array.
 *
 * ```json
 * { "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo hi" }] }
 * ```
 */
interface SdkHookEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string }>;
}

/**
 * Parses `hooks/hooks.json` from the fetched files and maps each SDK hook entry
 * back to the canonical neutral `HarnessHookAsset` form.
 *
 * The inverse mapping uses `NEUTRAL_EVENT_BY_SDK` — the reverse of
 * `SDK_HOOK_EVENT_BY_NEUTRAL` from `plugin-sdk-mappers.ts`.
 *
 * Returns an empty array when no `hooks/hooks.json` file is present.
 * Returns a `VettingError` when the file is present but malformed.
 */
function parseHooksJson(
  files: FetchedFile[],
): VettingResult<HarnessHookAsset[]> {
  const hooksFile = findFile(files, CC_HOOKS_PATH);
  if (!hooksFile) {
    return { ok: true, value: [] };
  }

  const parseResult = parseHooksJsonContent(hooksFile.contents);
  return parseResult;
}

/**
 * Parses the raw content of `hooks/hooks.json` and maps all entries to neutral
 * `HarnessHookAsset[]`. Extracted to reduce the cyclomatic complexity of
 * `parseHooksJson` while keeping a single logical flow.
 */
function parseHooksJsonContent(
  contents: string,
): VettingResult<HarnessHookAsset[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(contents) as unknown;
  } catch {
    return hooksJsonError(`${CC_HOOKS_PATH} is not valid JSON`);
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return hooksJsonError(
      `${CC_HOOKS_PATH}: expected a JSON object mapping SDK event names to hook arrays`,
    );
  }

  const result: HarnessHookAsset[] = [];

  for (const [sdkEvent, entries] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const eventResult = parseHooksEventEntries(sdkEvent, entries);
    if (!eventResult.ok) return eventResult;
    result.push(...eventResult.value);
  }

  return { ok: true, value: result };
}

/** Maps a single SDK event name + its raw entries to neutral hook assets. */
function parseHooksEventEntries(
  sdkEvent: string,
  entries: unknown,
): VettingResult<HarnessHookAsset[]> {
  const neutralEvent = NEUTRAL_EVENT_BY_SDK[sdkEvent];
  if (neutralEvent === undefined) {
    return {
      ok: false,
      error: {
        code: 'cc_hooks_unknown_event',
        message: `${CC_HOOKS_PATH}: unknown SDK hook event '${sdkEvent}' — supported events: ${Object.keys(NEUTRAL_EVENT_BY_SDK).join(', ')}`,
      },
    };
  }

  if (!Array.isArray(entries)) {
    return hooksJsonError(
      `${CC_HOOKS_PATH}: value for event '${sdkEvent}' must be an array`,
    );
  }

  const hooks: HarnessHookAsset[] = [];
  for (const entry of entries as SdkHookEntry[]) {
    const entryResult = parseSdkHookEntry(neutralEvent, entry);
    if (!entryResult.ok) return entryResult;
    hooks.push(...entryResult.value);
  }
  return { ok: true, value: hooks };
}

/** Converts a single `SdkHookEntry` to one or more neutral `HarnessHookAsset` objects. */
function parseSdkHookEntry(
  neutralEvent: HarnessHookEvent,
  entry: SdkHookEntry,
): VettingResult<HarnessHookAsset[]> {
  if (
    typeof entry !== 'object' ||
    entry === null ||
    !Array.isArray(entry.hooks)
  ) {
    return hooksJsonError(
      `${CC_HOOKS_PATH}: each entry must have a 'hooks' array`,
    );
  }

  const hooks: HarnessHookAsset[] = [];
  for (const h of entry.hooks) {
    if (h.type !== 'command' || typeof h.command !== 'string') {
      return hooksJsonError(
        `${CC_HOOKS_PATH}: each hook must be { type: "command", command: string }`,
      );
    }
    hooks.push({
      event: neutralEvent,
      ...(typeof entry.matcher === 'string' ? { matcher: entry.matcher } : {}),
      command: h.command,
    });
  }
  return { ok: true, value: hooks };
}

function hooksJsonError(message: string): VettingResult<never> {
  return { ok: false, error: { code: 'cc_hooks_invalid_json', message } };
}

// ---------------------------------------------------------------------------
// PI Extension vetting
// ---------------------------------------------------------------------------

/**
 * Vets a PI extension fetch result.
 *
 * v1 constraint: single-file `ts-module` only.
 * - Exactly one `.ts` file in the root of the fetched tree.
 * - The file's contents must contain `export default` (heuristic factory check).
 * - Multi-file imports and `runtime:'package'` are explicitly rejected.
 */
export function vetPiExtension(
  files: FetchedFile[],
): VettingResult<{ entry: string; moduleSource: string }> {
  // Reject package-style layouts (v1: single-file only).
  if (findFile(files, 'package.json')) {
    const error: VettingError = {
      code: 'pi_package_rejected',
      message:
        "Multi-file / packaged PI extensions ('package.json' detected) are not supported in v1 — " +
        'import a single .ts ExtensionFactory module instead',
    };
    return { ok: false, error };
  }

  const tsFiles = files.filter(
    (f) => f.path.endsWith('.ts') && !f.path.includes('/'),
  );

  if (tsFiles.length === 0) {
    const error: VettingError = {
      code: 'pi_no_ts_entry',
      message:
        'No root-level .ts file found — a single default-export ExtensionFactory .ts module is required',
    };
    return { ok: false, error };
  }

  if (tsFiles.length > 1) {
    const error: VettingError = {
      code: 'pi_multi_file_rejected',
      message:
        'Multiple root-level .ts files found — v1 supports only a single default-export ExtensionFactory .ts module',
    };
    return { ok: false, error };
  }

  // tsFiles.length === 1 is asserted above; the non-null assertion is safe here.
  const entryFile = tsFiles[0];
  const { contents } = entryFile;

  // Heuristic: the module must have a default export (the ExtensionFactory).
  // We do NOT execute the module — just check structurally.
  if (!contents.includes('export default')) {
    const error: VettingError = {
      code: 'pi_no_default_export',
      message:
        `${entryFile.path}: no 'export default' found — ` +
        'the entry module must export an ExtensionFactory as its default export',
    };
    return { ok: false, error };
  }

  return {
    ok: true,
    value: { entry: entryFile.path, moduleSource: contents },
  };
}

// ---------------------------------------------------------------------------
// Size cap enforcement
// ---------------------------------------------------------------------------

/**
 * Returns a `VettingError` when the total byte size of `files` exceeds `cap`,
 * or `null` when the size is within bounds.
 */
export function checkSizeCap(
  files: FetchedFile[],
  cap: number,
): VettingError | null {
  const total = totalBytes(files);
  if (total > cap) {
    return {
      code: 'size_cap_exceeded',
      message: `Fetched asset size ${total.toString()} bytes exceeds the cap of ${cap.toString()} bytes`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Denylist enforcement
// ---------------------------------------------------------------------------

/**
 * Returns a `VettingError` when `identifier` matches any entry in `denylist`
 * (case-insensitive), or `null` when it is not blocked.
 *
 * For git sources pass the repo URL; for registry sources pass the package name.
 */
export function checkDenylist(
  identifier: string,
  denylist: string[],
): VettingError | null {
  const lower = identifier.toLowerCase();
  const blocked = denylist.find((entry) => entry.toLowerCase() === lower);
  if (blocked !== undefined) {
    return {
      code: 'source_denylisted',
      message: `Source '${identifier}' is on the denylist`,
    };
  }
  return null;
}
