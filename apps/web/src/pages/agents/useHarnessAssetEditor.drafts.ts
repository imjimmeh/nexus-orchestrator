import { useCallback, useState } from "react";
import type {
  ExtensionDraft,
  ExtensionRuntime,
  HarnessContributionsValue,
  HookDraft,
  HookEvent,
  ScriptLanguage,
} from "./HarnessAssetEditor.types";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function seedHookDrafts(
  value: HarnessContributionsValue,
  nextId: () => number,
): HookDraft[] {
  if (!isObject(value)) return [];
  const hooksRaw = value["hooks"];
  if (!Array.isArray(hooksRaw)) return [];
  return hooksRaw.flatMap((h: unknown): HookDraft[] => {
    if (!isObject(h)) return [];
    const event = h["event"] as HookEvent | undefined;
    if (!event) return [];
    const hasScript = isObject(h["script"]);
    const scriptObj = hasScript ? (h["script"] as Record<string, unknown>) : {};
    return [
      {
        id: `hook-${nextId()}`,
        event,
        mode: hasScript ? "script" : "command",
        language: (scriptObj["language"] as ScriptLanguage) ?? "bash",
        source:
          typeof scriptObj["source"] === "string" ? scriptObj["source"] : "",
        command: typeof h["command"] === "string" ? h["command"] : "",
        matcher: typeof h["matcher"] === "string" ? h["matcher"] : "",
        timeoutMs:
          typeof h["timeoutMs"] === "number" ? String(h["timeoutMs"]) : "",
      },
    ];
  });
}

export function seedExtensionDrafts(
  value: HarnessContributionsValue,
  nextId: () => number,
): ExtensionDraft[] {
  if (!isObject(value)) return [];
  const extsRaw = value["extensions"];
  if (!Array.isArray(extsRaw)) return [];
  return extsRaw.flatMap((e: unknown): ExtensionDraft[] => {
    if (!isObject(e)) return [];
    return [
      {
        id: `ext-${nextId()}`,
        name: typeof e["name"] === "string" ? e["name"] : "",
        runtime: (e["runtime"] as ExtensionRuntime) ?? "ts-module",
        entry: typeof e["entry"] === "string" ? e["entry"] : "",
        moduleSource:
          typeof e["moduleSource"] === "string" ? e["moduleSource"] : "",
        moduleSourceError: null,
      },
    ];
  });
}

export function seedStringArray(
  value: HarnessContributionsValue,
  key: string,
): string[] {
  if (!isObject(value)) return [];
  const raw = value[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string");
}

// ---------------------------------------------------------------------------
// Extension draft patcher
// ---------------------------------------------------------------------------

function applyExtensionPatch(
  draft: ExtensionDraft,
  patch: Partial<Omit<ExtensionDraft, "id">>,
): ExtensionDraft {
  const next = { ...draft, ...patch };
  if (
    next.runtime === "ts-module" &&
    "moduleSource" in patch &&
    typeof patch.moduleSource === "string"
  ) {
    next.moduleSourceError =
      patch.moduleSource.length === 0
        ? "moduleSource is required for ts-module extensions"
        : null;
  } else if ("runtime" in patch && patch.runtime !== "ts-module") {
    next.moduleSourceError = null;
  }
  return next;
}

/** Manages hook + extension draft state with CRUD callbacks. */
export function useHookAndExtensionDrafts(
  initialHooks: HookDraft[],
  initialExtensions: ExtensionDraft[],
  nextId: () => number,
) {
  const [hookDrafts, setHookDrafts] = useState<HookDraft[]>(initialHooks);
  const [extensionDrafts, setExtensionDrafts] =
    useState<ExtensionDraft[]>(initialExtensions);

  const addHook = useCallback(
    () =>
      setHookDrafts((p) => [
        ...p,
        {
          id: `hook-${nextId()}`,
          event: "session_start",
          mode: "script",
          language: "bash",
          source: "",
          command: "",
          matcher: "",
          timeoutMs: "",
        },
      ]),
    [nextId],
  );
  const removeHook = useCallback(
    (id: string) => setHookDrafts((p) => p.filter((h) => h.id !== id)),
    [],
  );
  const updateHook = useCallback(
    (id: string, patch: Partial<Omit<HookDraft, "id">>) =>
      setHookDrafts((p) =>
        p.map((h) => (h.id === id ? { ...h, ...patch } : h)),
      ),
    [],
  );
  const addExtension = useCallback(
    () =>
      setExtensionDrafts((p) => [
        ...p,
        {
          id: `ext-${nextId()}`,
          name: "",
          runtime: "ts-module",
          entry: "",
          moduleSource: "",
          moduleSourceError: null,
        },
      ]),
    [nextId],
  );
  const removeExtension = useCallback(
    (id: string) => setExtensionDrafts((p) => p.filter((e) => e.id !== id)),
    [],
  );
  const updateExtension = useCallback(
    (id: string, patch: Partial<Omit<ExtensionDraft, "id">>) =>
      setExtensionDrafts((p) =>
        p.map((e) => (e.id === id ? applyExtensionPatch(e, patch) : e)),
      ),
    [],
  );

  return {
    hookDrafts,
    extensionDrafts,
    addHook,
    removeHook,
    updateHook,
    addExtension,
    removeExtension,
    updateExtension,
  };
}
