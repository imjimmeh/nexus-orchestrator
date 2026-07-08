import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface KeyValueFieldProps {
  label: string;
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  description?: string;
  id?: string;
}

function KeyValueField({
  label,
  entries,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  description,
  id,
}: KeyValueFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const entryPairs = Object.entries(entries);

  function handleAdd() {
    onChange({ ...entries, "": "" });
  }

  function handleRemove(keyToRemove: string) {
    const next: Record<string, string> = {};
    for (const [key, value] of entryPairs) {
      if (key !== keyToRemove) {
        next[key] = value;
      }
    }
    onChange(next);
  }

  function handleKeyChange(oldKey: string, newKey: string) {
    const next: Record<string, string> = {};
    for (const [key, value] of entryPairs) {
      if (key === oldKey) {
        next[newKey] = value;
      } else {
        next[key] = value;
      }
    }
    onChange(next);
  }

  function handleValueChange(keyToUpdate: string, newValue: string) {
    onChange({ ...entries, [keyToUpdate]: newValue });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <div className="space-y-1.5">
        {entryPairs.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No entries</p>
        )}
        {entryPairs.map(([key, value], index) => (
          <div key={key} className="flex items-center gap-1.5">
            <Input
              id={index === 0 ? fieldId : undefined}
              value={key}
              onChange={(e) => handleKeyChange(key, e.target.value)}
              placeholder={keyPlaceholder}
              className="h-8 flex-1"
            />
            <Input
              value={value}
              onChange={(e) => handleValueChange(key, e.target.value)}
              placeholder={valuePlaceholder}
              className="h-8 flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => handleRemove(key)}
              aria-label={`Remove ${key || "entry"}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1"
        onClick={handleAdd}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add
      </Button>
    </div>
  );
}

export { KeyValueField };
export type { KeyValueFieldProps };
