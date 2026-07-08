import { useCallback, useState } from "react";
import { api } from "@/lib/api/client";
import {
  confirmImportAsset,
  previewImportAsset,
} from "@/lib/api/harness-asset-api";
import type { HarnessAssetSource } from "@/lib/api/harness-asset-api.types";
import type {
  HarnessAssetImportProps,
  ImportFlowState,
  ImportPreviewResult,
  UseHarnessAssetImportResult,
} from "./HarnessAssetImport.types";

// ---------------------------------------------------------------------------
// Source parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON string into a `HarnessAssetSource`.
 * Throws a descriptive `Error` if the string is not valid JSON or does not
 * contain a recognised `kind` field.
 */
function parseSource(raw: string): HarnessAssetSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error(
      'Invalid source: must be valid JSON (e.g. { "kind": "git", "repo": "...", "ref": "..." })',
    );
  }

  if (parsed === null || typeof parsed !== "object" || !("kind" in parsed)) {
    throw new Error(
      'Invalid source: the JSON object must include a "kind" field ("git" or "registry").',
    );
  }

  const record = parsed as Record<string, unknown>;
  const kind = record["kind"];

  if (kind === "git") {
    if (
      typeof record["repo"] !== "string" ||
      typeof record["ref"] !== "string"
    ) {
      throw new Error(
        'Invalid git source: "repo" and "ref" are required string fields.',
      );
    }
    return {
      kind: "git",
      repo: record["repo"],
      ref: record["ref"],
      ...(typeof record["subdir"] === "string"
        ? { subdir: record["subdir"] }
        : {}),
    };
  }

  if (kind === "registry") {
    if (
      typeof record["name"] !== "string" ||
      typeof record["version"] !== "string"
    ) {
      throw new Error(
        'Invalid registry source: "name" and "version" are required string fields.',
      );
    }
    return {
      kind: "registry",
      name: record["name"],
      version: record["version"],
    };
  }

  throw new Error(
    `Unsupported source kind "${String(kind)}". Expected "git" or "registry".`,
  );
}

// ---------------------------------------------------------------------------
// Error message extraction
// ---------------------------------------------------------------------------

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred. Please try again.";
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Manages the external harness asset import flow state machine.
 *
 * Logic only — parse source → preview API call → render manifest → confirm
 * API call → fire `onImported`. All presentation lives in `HarnessAssetImport`.
 */
export function useHarnessAssetImport(
  onImported: HarnessAssetImportProps["onImported"],
  scopeNodeId?: string,
): UseHarnessAssetImportResult {
  const [sourceInput, setSourceInput] = useState("");
  const [state, setState] = useState<ImportFlowState>({ phase: "idle" });

  const reset = useCallback(() => {
    setState({ phase: "idle" });
  }, []);

  const preview = useCallback(async () => {
    let source: HarnessAssetSource;
    try {
      source = parseSource(sourceInput);
    } catch (err) {
      setState({ phase: "error", message: toErrorMessage(err) });
      return;
    }

    setState({ phase: "previewing" });

    let result: ImportPreviewResult;
    try {
      result = await previewImportAsset(api, source, scopeNodeId);
    } catch (err) {
      setState({ phase: "error", message: toErrorMessage(err) });
      return;
    }

    setState({ phase: "previewed", preview: result });
  }, [sourceInput, scopeNodeId]);

  const confirm = useCallback(async () => {
    if (state.phase !== "previewed" && state.phase !== "confirming") return;

    const previewResult =
      state.phase === "previewed" || state.phase === "confirming"
        ? (
            state as Extract<
              ImportFlowState,
              { phase: "previewed" | "confirming" }
            >
          ).preview
        : null;

    if (!previewResult) return;

    setState({ phase: "confirming", preview: previewResult });

    try {
      const { id } = await confirmImportAsset(
        api,
        previewResult.pinnedSource,
        scopeNodeId,
      );
      setState({ phase: "confirmed", id });
      onImported(id, previewResult.kind);
    } catch (err) {
      setState({ phase: "error", message: toErrorMessage(err) });
    }
  }, [state, scopeNodeId, onImported]);

  return {
    sourceInput,
    setSourceInput,
    state,
    preview,
    confirm,
    reset,
  };
}
