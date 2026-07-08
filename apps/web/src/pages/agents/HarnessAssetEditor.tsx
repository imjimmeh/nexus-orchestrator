import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useHarnessAssetEditor } from "./useHarnessAssetEditor";
import { RefList, SaveAsAssetForm } from "./HarnessAssetEditor.ref-list";
import { HarnessAssetImport } from "./HarnessAssetImport";
import type {
  ExtensionDraft,
  ExtensionRuntime,
  HarnessAssetEditorProps,
  HookDraft,
  HookEvent,
  HookMode,
  PersistStatus,
  ScriptLanguage,
} from "./HarnessAssetEditor.types";
import type { HarnessAssetKind } from "@/lib/api/harness-asset-api.types";

// ---------------------------------------------------------------------------
// Hook constants
// ---------------------------------------------------------------------------

const HOOK_EVENTS: { value: HookEvent; label: string }[] = [
  { value: "session_start", label: "Session Start" },
  { value: "session_end", label: "Session End" },
  { value: "pre_tool_use", label: "Pre Tool Use" },
  { value: "post_tool_use", label: "Post Tool Use" },
  { value: "user_prompt_submit", label: "User Prompt Submit" },
];

const SCRIPT_LANGUAGES: { value: ScriptLanguage; label: string }[] = [
  { value: "bash", label: "Bash" },
  { value: "node", label: "Node.js" },
  { value: "python", label: "Python" },
];

const EXTENSION_RUNTIMES: { value: ExtensionRuntime; label: string }[] = [
  { value: "ts-module", label: "TypeScript Module" },
  { value: "package", label: "Package" },
];

// ---------------------------------------------------------------------------
// HookRow — presentational row for a single hook draft
// ---------------------------------------------------------------------------

interface HookRowProps {
  draft: HookDraft;
  onUpdate: (patch: Partial<Omit<HookDraft, "id">>) => void;
  onRemove: () => void;
}

function HookRow({ draft, onUpdate, onRemove }: Readonly<HookRowProps>) {
  const isScript = draft.mode === "script";

  function handleModeChange(mode: HookMode): void {
    onUpdate({ mode });
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Hook</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label="Remove hook"
        >
          Remove
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium">Event</label>
          <Select
            value={draft.event}
            onValueChange={(v) => onUpdate({ event: v as HookEvent })}
          >
            <SelectTrigger aria-label="Hook event">
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent>
              {HOOK_EVENTS.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Type</label>
          <Select
            value={draft.mode}
            onValueChange={(v) => handleModeChange(v as HookMode)}
          >
            <SelectTrigger aria-label="Hook type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="script">Script</SelectItem>
              <SelectItem value="command">Command</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isScript ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs font-medium">Language</label>
            <Select
              value={draft.language}
              onValueChange={(v) => onUpdate({ language: v as ScriptLanguage })}
            >
              <SelectTrigger aria-label="Script language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCRIPT_LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Source</label>
            <Textarea
              aria-label="Hook script source"
              className="min-h-[80px] font-mono text-xs"
              value={draft.source}
              onChange={(e) => onUpdate({ source: e.target.value })}
              placeholder="#!/usr/bin/env bash&#10;echo 'hook fired'"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <label className="text-xs font-medium">Command</label>
          <Input
            aria-label="Hook command"
            value={draft.command}
            onChange={(e) => onUpdate({ command: e.target.value })}
            placeholder="/usr/local/bin/my-hook"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium">
            Matcher <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            aria-label="Hook matcher"
            value={draft.matcher}
            onChange={(e) => onUpdate({ matcher: e.target.value })}
            placeholder="glob or regex"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">
            Timeout ms <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            aria-label="Hook timeout"
            type="number"
            value={draft.timeoutMs}
            onChange={(e) => onUpdate({ timeoutMs: e.target.value })}
            placeholder="5000"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtensionRow — presentational row for a single extension draft
// ---------------------------------------------------------------------------

interface ExtensionRowProps {
  draft: ExtensionDraft;
  persistStatus: PersistStatus;
  onUpdate: (patch: Partial<Omit<ExtensionDraft, "id">>) => void;
  onRemove: () => void;
  onSaveAsAsset: (draftId: string, name: string, version: string) => void;
}

function ExtensionRow({
  draft,
  persistStatus,
  onUpdate,
  onRemove,
  onSaveAsAsset,
}: Readonly<ExtensionRowProps>) {
  const isTsModule = draft.runtime === "ts-module";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Extension</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label="Remove extension"
        >
          Remove
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium">Name</label>
          <Input
            aria-label="Extension name"
            value={draft.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="my-extension"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Runtime</label>
          <Select
            value={draft.runtime}
            onValueChange={(v) => onUpdate({ runtime: v as ExtensionRuntime })}
          >
            <SelectTrigger aria-label="Extension runtime">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXTENSION_RUNTIMES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">Entry point</label>
        <Input
          aria-label="Extension entry"
          value={draft.entry}
          onChange={(e) => onUpdate({ entry: e.target.value })}
          placeholder="dist/index.js"
        />
      </div>

      {isTsModule && (
        <div className="space-y-1">
          <label className="text-xs font-medium">Module source</label>
          <Textarea
            aria-label="Extension module source"
            className="min-h-[80px] font-mono text-xs"
            value={draft.moduleSource}
            onChange={(e) => onUpdate({ moduleSource: e.target.value })}
            placeholder="export default function handler() { ... }"
          />
          {draft.moduleSourceError && (
            <p
              className="text-sm text-destructive"
              role="alert"
              aria-label="Extension module source error"
            >
              {draft.moduleSourceError}
            </p>
          )}
        </div>
      )}

      <SaveAsAssetForm
        draftId={draft.id}
        status={persistStatus}
        onSave={onSaveAsAsset}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HarnessAssetEditor — top-level structured editor
// ---------------------------------------------------------------------------

/**
 * Structured harness asset authoring panel.
 *
 * Presentational: all state, serialisation logic, and API calls live in
 * `useHarnessAssetEditor`. Renders hook rows, extension rows with persist
 * controls, and ref-attach lists populated from GET /harness/assets.
 */
export function HarnessAssetEditor({
  value,
  onChange,
  scopeNodeId,
}: Readonly<HarnessAssetEditorProps>) {
  const {
    hookDrafts,
    extensionDrafts,
    pluginRefs,
    extensionRefs,
    pluginRefError,
    extensionRefError,
    availableAssets,
    assetsLoading,
    persistStatus,
    addHook,
    removeHook,
    updateHook,
    addExtension,
    removeExtension,
    updateExtension,
    addPluginRef,
    removePluginRef,
    addExtensionRef,
    removeExtensionRef,
    saveExtensionAsAsset,
  } = useHarnessAssetEditor(value, onChange, scopeNodeId);

  const availablePlugins = availableAssets.filter((a) => a.kind === "plugin");
  const availableExtensions = availableAssets.filter(
    (a) => a.kind === "extension",
  );

  return (
    <section className="space-y-4" aria-label="Harness asset editor">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Hooks</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addHook}
            aria-label="Add hook"
          >
            + Add hook
          </Button>
        </div>
        {hookDrafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hooks authored.</p>
        ) : (
          hookDrafts.map((draft) => (
            <HookRow
              key={draft.id}
              draft={draft}
              onUpdate={(patch) => updateHook(draft.id, patch)}
              onRemove={() => removeHook(draft.id)}
            />
          ))
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Extensions</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addExtension}
            aria-label="Add extension"
          >
            + Add extension
          </Button>
        </div>
        {extensionDrafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No extensions authored.
          </p>
        ) : (
          extensionDrafts.map((draft) => (
            <ExtensionRow
              key={draft.id}
              draft={draft}
              persistStatus={persistStatus[draft.id] ?? { state: "idle" }}
              onUpdate={(patch) => updateExtension(draft.id, patch)}
              onRemove={() => removeExtension(draft.id)}
              onSaveAsAsset={saveExtensionAsAsset}
            />
          ))
        )}
      </div>

      <div className="space-y-4 rounded-md border p-3">
        <h4 className="text-sm font-medium">Attach existing assets by id</h4>
        <RefList
          label="Plugin refs"
          refs={pluginRefs}
          error={pluginRefError}
          inputAriaLabel="Plugin asset id"
          addButtonLabel="Attach plugin"
          availableAssets={availablePlugins}
          assetsLoading={assetsLoading}
          onAdd={addPluginRef}
          onRemove={removePluginRef}
        />
        <RefList
          label="Extension refs"
          refs={extensionRefs}
          error={extensionRefError}
          inputAriaLabel="Extension asset id"
          addButtonLabel="Attach extension"
          availableAssets={availableExtensions}
          assetsLoading={assetsLoading}
          onAdd={addExtensionRef}
          onRemove={removeExtensionRef}
        />
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <h4 className="text-sm font-medium">Import external asset</h4>
        <p className="text-sm text-muted-foreground">
          Import an asset from a git repository or registry. After confirmation
          the asset id is automatically attached to the appropriate ref list.
        </p>
        <HarnessAssetImport
          scopeNodeId={scopeNodeId}
          onImported={(
            id: string,
            kind: Extract<HarnessAssetKind, "plugin" | "extension">,
          ) => {
            if (kind === "plugin") {
              addPluginRef(id);
            } else {
              addExtensionRef(id);
            }
          }}
        />
      </div>
    </section>
  );
}
