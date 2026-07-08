import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { listHarnessAssets } from "@/lib/api/harness-asset-api";
import type { HarnessAssetRecord } from "@/lib/api/harness-asset-api.types";
import type {
  ExtensionOutput,
  HarnessContributionsValue,
  HookOutput,
  PersistStatus,
  UseHarnessAssetEditorResult,
} from "./HarnessAssetEditor.types";
import { persistExtensionAsDraft } from "./useHarnessAssetEditor.persist";
import { useAssetRefs } from "./useHarnessAssetEditor.refs";
import {
  seedExtensionDrafts,
  seedHookDrafts,
  seedStringArray,
  useHookAndExtensionDrafts,
} from "./useHarnessAssetEditor.drafts";

// ---------------------------------------------------------------------------
// Per-instance id counter — useRef so each hook instance is isolated (Fix C)
// ---------------------------------------------------------------------------

function useCounter(): () => number {
  const ref = useRef(0);
  return useCallback(() => {
    ref.current += 1;
    return ref.current;
  }, []);
}

// ---------------------------------------------------------------------------
// Serialisation — drafts → HarnessContributionsValue
// ---------------------------------------------------------------------------

function buildOutput(
  hookDrafts: ReturnType<typeof seedHookDrafts>,
  extensionDrafts: ReturnType<typeof seedExtensionDrafts>,
  pluginRefs: string[],
  extensionRefs: string[],
): HarnessContributionsValue {
  const hooks = hookDrafts
    .map((d) => {
      if (!d.event) return null;
      const base = {
        event: d.event,
        ...(d.matcher ? { matcher: d.matcher } : {}),
        ...(d.timeoutMs ? { timeoutMs: parseInt(d.timeoutMs, 10) } : {}),
      };
      if (d.mode === "script") {
        if (!d.source) return null;
        return { ...base, script: { language: d.language, source: d.source } };
      }
      if (!d.command) return null;
      return { ...base, command: d.command };
    })
    .filter((h): h is HookOutput => h !== null);

  const extensions = extensionDrafts
    .map((d) => {
      if (!d.name || !d.entry) return null;
      const out: ExtensionOutput = {
        name: d.name,
        runtime: d.runtime,
        entry: d.entry,
      };
      if (d.moduleSource) out.moduleSource = d.moduleSource;
      return out;
    })
    .filter((e): e is ExtensionOutput => e !== null);

  const out: Record<string, unknown> = {};
  if (hooks.length > 0) out["hooks"] = hooks;
  if (extensions.length > 0) out["extensions"] = extensions;
  if (pluginRefs.length > 0) out["pluginRefs"] = pluginRefs;
  if (extensionRefs.length > 0) out["extensionRefs"] = extensionRefs;
  return Object.keys(out).length === 0 ? null : out;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Manages all editor state for the structured harness asset authoring panel.
 *
 * Logic only — emits the serialised `HarnessContributionsValue` to `onChange`
 * whenever state changes. Validates extension `moduleSource` inline.
 *
 * Persist: `saveExtensionAsAsset` calls `POST /harness/assets`; on success
 * adds the returned id to `extensionRefs`. Attach picker populated from
 * `GET /harness/assets` loaded on mount.
 */
export function useHarnessAssetEditor(
  value: HarnessContributionsValue,
  onChange: (next: HarnessContributionsValue) => void,
  scopeNodeId?: string,
): UseHarnessAssetEditorResult {
  const nextId = useCounter();
  const drafts = useHookAndExtensionDrafts(
    seedHookDrafts(value, nextId),
    seedExtensionDrafts(value, nextId),
    nextId,
  );
  const refs = useAssetRefs(
    seedStringArray(value, "pluginRefs"),
    seedStringArray(value, "extensionRefs"),
  );
  const [availableAssets, setAvailableAssets] = useState<HarnessAssetRecord[]>(
    [],
  );
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [persistStatus, setPersistStatus] = useState<
    Record<string, PersistStatus>
  >({});

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    onChangeRef.current(
      buildOutput(
        drafts.hookDrafts,
        drafts.extensionDrafts,
        refs.pluginRefs,
        refs.extensionRefs,
      ),
    );
  }, [
    drafts.hookDrafts,
    drafts.extensionDrafts,
    refs.pluginRefs,
    refs.extensionRefs,
  ]);

  useEffect(() => {
    let cancelled = false;
    setAssetsLoading(true);
    listHarnessAssets(api, scopeNodeId)
      .then((assets) => {
        if (!cancelled) setAvailableAssets(assets);
      })
      .catch(() => {
        /* Non-fatal: picker stays empty. */
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeNodeId]);

  const saveExtensionAsAsset = useCallback(
    async (draftId: string, assetName: string, version: string) => {
      await persistExtensionAsDraft(
        draftId,
        assetName,
        version,
        drafts.extensionDrafts,
        scopeNodeId,
        {
          onStatusChange: (id, status) =>
            setPersistStatus((prev) => ({ ...prev, [id]: status })),
          onRefAdded: (assetId) =>
            refs.setExtensionRefs((prev) =>
              prev.includes(assetId) ? prev : [...prev, assetId],
            ),
          onAssetCreated: (asset) =>
            setAvailableAssets((prev) =>
              prev.some((a) => a.id === asset.id) ? prev : [...prev, asset],
            ),
        },
      );
    },
    [drafts.extensionDrafts, scopeNodeId, refs],
  );

  return {
    ...drafts,
    pluginRefs: refs.pluginRefs,
    extensionRefs: refs.extensionRefs,
    pluginRefError: refs.pluginRefError,
    extensionRefError: refs.extensionRefError,
    addPluginRef: refs.addPluginRef,
    removePluginRef: refs.removePluginRef,
    addExtensionRef: refs.addExtensionRef,
    removeExtensionRef: refs.removeExtensionRef,
    availableAssets,
    assetsLoading,
    persistStatus,
    saveExtensionAsAsset,
  };
}
