import { useState } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SystemSetting } from "@/lib/api/settings.types";
import { getSettingRiskWarning } from "./systemSettings.helpers";

export function SystemSettingsStringArrayRow(props: {
  setting: SystemSetting;
  label: string;
  description: string;
  value: string[];
  isUpdating: boolean;
  onValueChange: (next: string[]) => void;
  onSave: (value: unknown) => void;
}) {
  const {
    setting,
    label,
    description,
    value,
    isUpdating,
    onValueChange,
    onSave,
  } = props;
  const [newItem, setNewItem] = useState("");
  const originalValue = JSON.stringify(
    Array.isArray(setting.value) ? (setting.value as string[]) : [],
  );
  const changed = JSON.stringify(value) !== originalValue;
  const warning = getSettingRiskWarning(setting.key, value);

  const addItem = () => {
    const trimmed = newItem.trim();
    if (trimmed && !value.includes(trimmed)) {
      onValueChange([...value, trimmed]);
      setNewItem("");
    }
  };

  const removeItem = (index: number) => {
    onValueChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, i) => (
            <Badge key={i} variant="secondary" className="gap-1">
              {item}
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="ml-1 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Add item..."
          className="flex-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={addItem}
          disabled={!newItem.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => onSave(value)}
          disabled={isUpdating || !changed}
        >
          {isUpdating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
        </Button>
      </div>
      {warning && <p className="text-xs text-amber-600">{warning}</p>}
    </div>
  );
}
