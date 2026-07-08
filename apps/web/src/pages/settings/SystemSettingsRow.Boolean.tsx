import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SystemSetting } from "@/lib/api/settings.types";
import { getSettingRiskWarning } from "./systemSettings.helpers";

export function SystemSettingsBooleanRow(
  props: Readonly<{
    setting: SystemSetting;
    label: string;
    description: string;
    value: boolean;
    isUpdating: boolean;
    onValueChange: (next: boolean) => void;
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
  const originalValue = Boolean(setting.value);
  const changed = value !== originalValue;
  const warning = getSettingRiskWarning(setting.key, value);
  const saveDisabled = isUpdating || !changed;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label
            htmlFor={`setting-${setting.key}`}
            className="flex items-center gap-2"
          >
            {label}
            <Checkbox
              id={`setting-${setting.key}`}
              checked={value}
              onCheckedChange={(checked) => onValueChange(checked === true)}
              disabled={isUpdating}
            />
          </Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSave(value)}
          disabled={saveDisabled}
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
