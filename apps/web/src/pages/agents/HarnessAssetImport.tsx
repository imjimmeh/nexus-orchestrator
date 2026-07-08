import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ImportFlowState, ImportPreviewResult } from "./HarnessAssetImport.types";
import { useHarnessAssetImport } from "./useHarnessAssetImport";
import type { HarnessAssetImportProps } from "./HarnessAssetImport.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the pinned reference label from a preview's pinned source.
 *
 * Returns `""` when the source is the local `authored` variant which has no
 * external ref to pin to.
 */
function resolvePinnedRef(
  pinnedSource: ImportPreviewResult["pinnedSource"],
): string {
  if (pinnedSource.kind === "git") return pinnedSource.ref;
  if (pinnedSource.kind === "registry") return pinnedSource.version;
  return "";
}

// ---------------------------------------------------------------------------
// ManifestSummary — renders the safe manifest fields returned by preview
// ---------------------------------------------------------------------------

interface ManifestSummaryProps {
  manifest: Record<string, unknown>;
}

/**
 * Renders the safe manifest summary fields.
 *
 * Only scalar values from the API-returned manifest are displayed.
 * Secret values are never passed by the API, so this component has no
 * mechanism to expose them.
 */
function ManifestSummary({ manifest }: Readonly<ManifestSummaryProps>) {
  const entries = Object.entries(manifest).filter(
    ([, v]) =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  );

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No manifest fields.</p>;
  }

  return (
    <dl className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-sm">
          <dt className="font-medium text-muted-foreground">{key}:</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// PreviewSection — renders the previewed manifest + pinned ref + checksum
// ---------------------------------------------------------------------------

interface PreviewSectionProps {
  preview: ImportPreviewResult;
}

/** Renders the preview block once the preview API call has resolved. */
function PreviewSection({ preview }: Readonly<PreviewSectionProps>) {
  const pinnedRef = resolvePinnedRef(preview.pinnedSource);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <h4 className="text-sm font-medium">Preview</h4>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="space-y-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            Kind
          </span>
          <p>{preview.kind}</p>
        </div>
        <div className="space-y-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            Pinned ref
          </span>
          <p className="font-mono text-xs">{pinnedRef}</p>
        </div>
        <div className="col-span-2 space-y-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            Checksum
          </span>
          <p className="font-mono text-xs">{preview.checksum}</p>
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          Manifest
        </span>
        <ManifestSummary manifest={preview.manifest} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusMessages — renders error and confirmed banners
// ---------------------------------------------------------------------------

interface StatusMessagesProps {
  state: ImportFlowState;
}

/** Renders the error and confirmed banners above the action buttons. */
function StatusMessages({ state }: Readonly<StatusMessagesProps>) {
  if (state.phase === "error") {
    return (
      <p
        role="alert"
        aria-label="Import error"
        className="text-sm text-destructive"
      >
        {state.message}
      </p>
    );
  }

  if (state.phase === "confirmed") {
    return (
      <div className="rounded-md border border-green-500 p-3 text-sm">
        <p className="font-medium text-green-700">Import confirmed.</p>
        <p className="text-muted-foreground">
          Asset id: <code className="text-xs">{state.id}</code>
        </p>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// ActionButtons — renders the button cluster based on phase
// ---------------------------------------------------------------------------

interface ActionButtonsProps {
  state: ImportFlowState;
  sourceInput: string;
  onPreview: () => void;
  onConfirm: () => void;
  onReset: () => void;
}

/** Renders the buttons appropriate to the current import phase. */
function ActionButtons({
  state,
  sourceInput,
  onPreview,
  onConfirm,
  onReset,
}: Readonly<ActionButtonsProps>) {
  const phase = state.phase;
  const isPreviewing = phase === "previewing";
  const isConfirming = phase === "confirming";
  const isPreviewedOrConfirming = phase === "previewed" || isConfirming;
  const isConfirmed = phase === "confirmed";

  if (!isPreviewedOrConfirming && !isConfirmed) {
    return (
      <Button
        type="button"
        onClick={onPreview}
        disabled={isPreviewing || sourceInput.trim() === ""}
        aria-label="Preview"
      >
        {isPreviewing ? "Previewing…" : "Preview"}
      </Button>
    );
  }

  if (isPreviewedOrConfirming) {
    return (
      <>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isConfirming}
          aria-label="Confirm import"
        >
          {isConfirming ? "Confirming…" : "Confirm import"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          disabled={isConfirming}
          aria-label="Back to edit"
        >
          Back
        </Button>
      </>
    );
  }

  // Confirmed or errored without an active preview — offer reset.
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onReset}
      aria-label="Reset import"
    >
      {isConfirmed ? "Import another" : "Try again"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// HarnessAssetImport — top-level import flow component
// ---------------------------------------------------------------------------

/**
 * External harness asset import flow.
 *
 * Presentational component: paste a source JSON descriptor → preview shows
 * the resolved manifest, kind, pinned ref, and checksum → confirm persists
 * the asset and fires `onImported(id, kind)` so the caller can append the id
 * to `pluginRefs` or `extensionRefs`.
 *
 * All state, parsing, and API calls live in `useHarnessAssetImport`.
 */
export function HarnessAssetImport({
  onImported,
  scopeNodeId,
}: Readonly<HarnessAssetImportProps>) {
  const { sourceInput, setSourceInput, state, preview, confirm, reset } =
    useHarnessAssetImport(onImported, scopeNodeId);

  const showPreview =
    state.phase === "previewed" || state.phase === "confirming";
  const previewData =
    state.phase === "previewed" || state.phase === "confirming"
      ? state.preview
      : null;

  return (
    <section className="space-y-4" aria-label="Import external harness asset">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="import-source-input">
          Import source
        </label>
        <p className="text-sm text-muted-foreground">
          Paste a JSON source descriptor. Example:{" "}
          <code className="text-xs">
            {`{"kind":"git","repo":"https://github.com/acme/plugin","ref":"main"}`}
          </code>
        </p>
        <Textarea
          id="import-source-input"
          aria-label="Import source"
          className="min-h-[80px] font-mono text-xs"
          value={sourceInput}
          onChange={(e) => setSourceInput(e.target.value)}
          placeholder='{"kind":"git","repo":"https://github.com/acme/plugin","ref":"main"}'
          disabled={
            state.phase === "previewing" ||
            state.phase === "confirming" ||
            state.phase === "confirmed"
          }
        />
      </div>

      <StatusMessages state={state} />

      {showPreview && previewData ? <PreviewSection preview={previewData} /> : null}

      <div className="flex gap-2">
        <ActionButtons
          state={state}
          sourceInput={sourceInput}
          onPreview={preview}
          onConfirm={confirm}
          onReset={reset}
        />
      </div>
    </section>
  );
}
