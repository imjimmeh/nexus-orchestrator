import type { FallbackChainEntry } from "@nexus/core";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FallbackChainEditorProps {
  value: FallbackChainEntry[];
  onChange: (next: FallbackChainEntry[]) => void;
  providers: { name: string }[];
  models: { name: string; provider_name?: string | null }[];
}

export function FallbackChainEditor({
  value,
  onChange,
  providers,
  models,
}: Readonly<FallbackChainEditorProps>) {
  function addEntry(): void {
    onChange([...value, { provider_name: "", model_name: "" }]);
  }

  function removeEntry(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  function moveEntry(index: number, direction: -1 | 1): void {
    const toIndex = index + direction;
    const next = [...value];
    const from = next[index];
    const to = next[toIndex];
    if (from === undefined || to === undefined) return;
    next[index] = to;
    next[toIndex] = from;
    onChange(next);
  }

  function patchEntry(index: number, patch: Partial<FallbackChainEntry>): void {
    onChange(value.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  if (value.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No fallback entries configured.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={addEntry}>
          Add fallback
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {value.map((entry, index) => (
        <div
          key={`${entry.provider_name}::${entry.model_name}::${index}`}
          className="flex items-center gap-2"
        >
          <Select
            value={entry.provider_name !== "" ? entry.provider_name : undefined}
            onValueChange={(v) => patchEntry(index, { provider_name: v })}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={entry.model_name !== "" ? entry.model_name : undefined}
            onValueChange={(v) => patchEntry(index, { model_name: v })}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.name} value={m.name}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => moveEntry(index, -1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Move down"
            disabled={index === value.length - 1}
            onClick={() => moveEntry(index, 1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Remove entry"
            onClick={() => removeEntry(index)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addEntry}>
        Add fallback
      </Button>
    </div>
  );
}
