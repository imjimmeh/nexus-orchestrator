import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HarnessAssetRecord } from "@/lib/api/harness-asset-api.types";
import type { PersistStatus } from "./HarnessAssetEditor.types";

// ---------------------------------------------------------------------------
// SaveAsAssetForm — inline form for persisting an extension draft as an asset
// ---------------------------------------------------------------------------

interface SaveAsAssetFormProps {
  draftId: string;
  status: PersistStatus;
  onSave: (draftId: string, name: string, version: string) => void;
}

export function SaveAsAssetForm({
  draftId,
  status,
  onSave,
}: Readonly<SaveAsAssetFormProps>) {
  const [assetName, setAssetName] = useState("");
  const [version, setVersion] = useState("1.0.0");

  function handleSave(): void {
    onSave(draftId, assetName, version);
  }

  return (
    <div className="space-y-1 rounded-sm bg-muted/50 p-2">
      <p className="text-xs font-medium text-muted-foreground">
        Save as reusable asset
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Asset name"
          value={assetName}
          onChange={(e) => setAssetName(e.target.value)}
          placeholder="my-extension-asset"
          className="flex-1 text-xs"
        />
        <Input
          aria-label="Asset version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="1.0.0"
          className="w-24 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={status.state === "pending" || !assetName.trim()}
          aria-label="Save extension as reusable asset"
        >
          {status.state === "pending" ? "Saving…" : "Save"}
        </Button>
      </div>
      {status.state === "error" && (
        <p
          className="text-xs text-destructive"
          role="alert"
          aria-label="Persist asset error"
        >
          {status.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RefList — manage attach-by-id lists with optional picker from available assets
// ---------------------------------------------------------------------------

interface RefListProps {
  label: string;
  refs: string[];
  error: string | null;
  inputAriaLabel: string;
  addButtonLabel: string;
  availableAssets: HarnessAssetRecord[];
  assetsLoading: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}

export function RefList({
  label,
  refs,
  error,
  inputAriaLabel,
  addButtonLabel,
  availableAssets,
  assetsLoading,
  onAdd,
  onRemove,
}: Readonly<RefListProps>) {
  const [input, setInput] = useState("");

  function handleAdd(): void {
    onAdd(input);
    setInput("");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{label}</p>

      {/* Manual id entry */}
      <div className="flex gap-2">
        <Input
          aria-label={inputAriaLabel}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="asset-uuid"
          className="flex-1 font-mono text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          {addButtonLabel}
        </Button>
      </div>

      {/* Attach picker — from GET /harness/assets */}
      {assetsLoading && (
        <p className="text-xs text-muted-foreground">Loading assets…</p>
      )}
      {!assetsLoading && availableAssets.length > 0 && (
        <div className="space-y-1" aria-label="Available assets picker">
          <p className="text-xs text-muted-foreground">
            Or attach from saved assets:
          </p>
          {availableAssets.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center justify-between rounded-sm bg-muted/50 px-2 py-1"
            >
              <span className="font-mono text-xs">
                {asset.name}{" "}
                <span className="text-muted-foreground">v{asset.version}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAdd(asset.id)}
                disabled={refs.includes(asset.id)}
                aria-label={`Attach asset ${asset.name}`}
              >
                {refs.includes(asset.id) ? "Attached" : "Attach"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {refs.length > 0 && (
        <ul className="space-y-1">
          {refs.map((id) => (
            <li
              key={id}
              className="flex items-center justify-between rounded-sm bg-muted px-2 py-1"
            >
              <span className="font-mono text-xs">{id}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemove(id)}
                aria-label={`Remove ${id}`}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
