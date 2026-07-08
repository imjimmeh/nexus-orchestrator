import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SystemSetting } from "@/lib/api/settings.types";
import {
  getNumberMinError,
  getNumberRangeError,
  getSettingRiskWarning,
  parseNumberInput,
} from "./systemSettings.helpers";

export function SystemSettingsNumberRow(
  props: Readonly<{
    setting: SystemSetting;
    label: string;
    description: string;
    min?: number;
    max?: number;
    value: string;
    isUpdating: boolean;
    onValueChange: (next: string) => void;
    onSave: (value: unknown) => void;
  }>,
) {
  const {
    setting,
    label,
    description,
    min,
    max,
    value,
    isUpdating,
    onValueChange,
    onSave,
  } = props;
  const parsed = parseNumberInput(value);
  const changed = parsed !== null && parsed !== Number(setting.value);
  const rangeError = getNumberRangeError(parsed, min, max);
  const minError = getNumberMinError(parsed, min, max);
  const saveDisabled =
    isUpdating || parsed === null || !changed || !!rangeError || !!minError;
  const warning =
    parsed === null ? null : getSettingRiskWarning(setting.key, parsed);

  return (
    <div className="space-y-1">
      <Label htmlFor={`setting-${setting.key}`}>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex gap-2">
        <Input
          id={`setting-${setting.key}`}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="flex-1 text-sm"
        />
        <Button
          size="sm"
          onClick={() => {
            if (parsed !== null) {
              onSave(parsed);
            }
          }}
          disabled={saveDisabled}
        >
          {isUpdating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
        </Button>
      </div>
      {rangeError && <p className="text-xs text-destructive">{rangeError}</p>}
      {minError && <p className="text-xs text-destructive">{minError}</p>}
      {warning && <p className="text-xs text-amber-600">{warning}</p>}
    </div>
  );
}
