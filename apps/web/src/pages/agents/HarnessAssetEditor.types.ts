import type { HarnessAssetRecord } from "@/lib/api/harness-asset-api.types";

/**
 * The raw harness contributions value stored on the agent profile.
 *
 * Moved here from `useHarnessContributionsField.types.ts` (now deleted) so
 * all editor types live in one place.
 */
export type HarnessContributionsValue = Record<string, unknown> | null;

/** Supported hook event types. */
export type HookEvent =
  | "session_start"
  | "session_end"
  | "pre_tool_use"
  | "post_tool_use"
  | "user_prompt_submit";

/** Discriminant for the hook authoring mode. */
export type HookMode = "script" | "command";

/** Supported script languages for hook_script assets. */
export type ScriptLanguage = "bash" | "node" | "python";

/** Extension runtime types. */
export type ExtensionRuntime = "ts-module" | "package";

/**
 * Local (in-editor) state for a hook being authored.
 *
 * Fields shared between both modes (event / matcher / timeoutMs) are preserved
 * when toggling between `script` and `command` (Behavior 2).
 */
export interface HookDraft {
  readonly id: string;
  readonly event: HookEvent;
  readonly mode: HookMode;
  /** Only relevant when mode === "script". */
  readonly language: ScriptLanguage;
  /** Only relevant when mode === "script". */
  readonly source: string;
  /** Only relevant when mode === "command". */
  readonly command: string;
  readonly matcher: string;
  /** Raw string so the user can type partial numbers; validated on commit. */
  readonly timeoutMs: string;
}

/**
 * Local (in-editor) state for a ts-module extension being authored.
 */
export interface ExtensionDraft {
  readonly id: string;
  readonly name: string;
  readonly runtime: ExtensionRuntime;
  readonly entry: string;
  readonly moduleSource: string;
  /** Inline validation error surfaced when moduleSource is empty for ts-module. */
  readonly moduleSourceError: string | null;
}

/**
 * The combined output shape produced by the editor.
 *
 * Extends `harness_contributions` with `pluginRefs` / `extensionRefs` for
 * attach-by-id, so that `gatherContributionSources` can hydrate them during
 * session creation.
 */
export interface HarnessContributionsOutput {
  hooks?: HookOutput[];
  extensions?: ExtensionOutput[];
  pluginRefs?: string[];
  extensionRefs?: string[];
}

/** Serialised hook payload (matches HarnessHookAsset). */
export type HookOutput =
  | {
      event: HookEvent;
      matcher?: string;
      timeoutMs?: number;
      script: { language: ScriptLanguage; source: string };
    }
  | {
      event: HookEvent;
      matcher?: string;
      timeoutMs?: number;
      command: string;
    };

/** Serialised extension payload (ts-module subset authored inline). */
export interface ExtensionOutput {
  name: string;
  runtime: ExtensionRuntime;
  entry: string;
  moduleSource?: string;
}

/** Props for the `HarnessAssetEditor` component. */
export interface HarnessAssetEditorProps {
  /**
   * Current contributions value from the form (read to seed drafts on mount).
   */
  readonly value: HarnessContributionsValue;
  /**
   * Called whenever the editor's authorised output changes so the parent form
   * field can update its `harness_contributions` value.
   */
  readonly onChange: (next: HarnessContributionsValue) => void;
  /**
   * Scope node id used when persisting authored assets via `POST /harness/assets`.
   * Omit for platform-global assets.
   */
  readonly scopeNodeId?: string;
}

/** Describes the state of a persist-as-reusable-asset operation. */
export type PersistStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "error"; message: string };

/**
 * Callbacks injected into `persistExtensionAsDraft` to update hook state.
 * Kept here (not in the `.persist.ts` helper) so all exported types are in
 * one dedicated `*.types.ts` file.
 */
export interface SaveExtensionAsAssetCallbacks {
  onStatusChange: (draftId: string, status: PersistStatus) => void;
  onRefAdded: (assetId: string) => void;
  onAssetCreated: (asset: HarnessAssetRecord) => void;
}

/** Return type of `useHarnessAssetEditor`. */
export interface UseHarnessAssetEditorResult {
  hookDrafts: HookDraft[];
  extensionDrafts: ExtensionDraft[];
  pluginRefs: string[];
  extensionRefs: string[];
  pluginRefError: string | null;
  extensionRefError: string | null;
  /** Assets loaded from `GET /harness/assets` for the attach picker. */
  availableAssets: HarnessAssetRecord[];
  /** True while the asset list is loading. */
  assetsLoading: boolean;
  /**
   * Status of the last "save as reusable asset" operation, keyed by the
   * extension draft id so each row shows its own state.
   */
  persistStatus: Record<string, PersistStatus>;
  addHook: () => void;
  removeHook: (id: string) => void;
  updateHook: (id: string, patch: Partial<Omit<HookDraft, "id">>) => void;
  addExtension: () => void;
  removeExtension: (id: string) => void;
  updateExtension: (
    id: string,
    patch: Partial<Omit<ExtensionDraft, "id">>,
  ) => void;
  addPluginRef: (assetId: string) => void;
  removePluginRef: (assetId: string) => void;
  addExtensionRef: (assetId: string) => void;
  removeExtensionRef: (assetId: string) => void;
  /**
   * Persist an authored extension draft as a reusable harness asset via
   * `POST /harness/assets`. On success the returned asset id is added to
   * `extensionRefs`. Errors surface via `persistStatus[draftId]`.
   */
  saveExtensionAsAsset: (
    draftId: string,
    assetName: string,
    version: string,
  ) => Promise<void>;
}
