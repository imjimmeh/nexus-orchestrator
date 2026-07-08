import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SystemSetting } from "@/lib/api/settings.types";
import { getSettingRiskWarning } from "./systemSettings.helpers";

export function SystemSettingsJsonRow(
  props: Readonly<{
    setting: SystemSetting;
    label: string;
    description: string;
    value: Record<string, string>;
    isUpdating: boolean;
    onValueChange: (next: Record<string, string>) => void;
    onSave: (value: unknown) => void;
  }>,
) {
  const {
    setting,
    label,
    description,
    value,
    isUpdating,
    onValueChange,
    onSave,
  } = props;
  const originalValue = JSON.stringify(
    typeof setting.value === "object" && setting.value !== null
      ? Object.fromEntries(
          Object.entries(setting.value as Record<string, unknown>).map(
            ([k, v]) => [k, JSON.stringify(v)],
          ),
        )
      : {},
  );
  const changed = JSON.stringify(value) !== originalValue;
  const entries = Object.entries(value);
  const warning = getSettingRiskWarning(setting.key, value);

  const updateKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onValueChange(next);
  };

  const updateValue = (key: string, jsonValue: string) => {
    onValueChange({ ...value, [key]: jsonValue });
  };

  const removeKey = (key: string) => {
    const next = { ...value };
    delete next[key];
    onValueChange(next);
  };

  const addField = () => {
    let newKey = "new_field";
    let suffix = 1;
    while (Object.prototype.hasOwnProperty.call(value, newKey)) {
      newKey = `new_field_${suffix}`;
      suffix += 1;
    }
    onValueChange({ ...value, [newKey]: "" });
  };

  const buildJsonObject = (): Record<string, unknown> | null => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v.trim() === "") {
        obj[k] = null;
        continue;
      }
      try {
        obj[k] = JSON.parse(v);
      } catch {
        return null;
      }
    }
    return obj;
  };

  const hasInvalidJson = Object.entries(value).some(([, v]) => {
    if (v.trim() === "") {
      return false;
    }
    try {
      JSON.parse(v);
      return false;
    } catch {
      return true;
    }
  });

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="space-y-2">
        {entries.map(([key, jsonValue]) => (
          <div key={key} className="flex gap-2 items-start">
            <Input
              value={key}
              onChange={(e) => updateKey(key, e.target.value)}
              className="w-1/3 text-sm font-mono"
              placeholder="Key"
            />
            <Textarea
              value={jsonValue}
              onChange={(e) => updateValue(key, e.target.value)}
              className="flex-1 font-mono text-xs min-h-[40px]"
              placeholder="JSON value"
              rows={1}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => removeKey(key)}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={addField} className="gap-1">
        <Plus className="h-3 w-3" />
        Add Field
      </Button>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            const obj = buildJsonObject();
            if (obj !== null) {
              onSave(obj);
            }
          }}
          disabled={isUpdating || !changed || hasInvalidJson}
        >
          {isUpdating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
        </Button>
      </div>
      {hasInvalidJson && (
        <p className="text-xs text-destructive">
          One or more values contain invalid JSON.
        </p>
      )}
      {warning && <p className="text-xs text-amber-600">{warning}</p>}
    </div>
  );
}
