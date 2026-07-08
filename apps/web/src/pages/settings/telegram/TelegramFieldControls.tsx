import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readPositiveInteger } from "../telegramSettingsCard.helpers";
import type { TelegramSettingsDraft } from "../telegramSettingsCard.types";

function applyPositiveIntegerPatch(
  nextValue: string,
  key: keyof TelegramSettingsDraft,
  onPatch: (patch: Partial<TelegramSettingsDraft>) => void,
): void {
  const parsed = readPositiveInteger(nextValue);
  if (parsed !== null) {
    onPatch({ [key]: parsed });
  }
}

export function NumericSettingInput(
  props: Readonly<{
    draft: TelegramSettingsDraft;
    field: {
      key: keyof TelegramSettingsDraft;
      inputId: string;
      label: string;
    };
    onPatch: (patch: Partial<TelegramSettingsDraft>) => void;
  }>,
) {
  const { draft, field, onPatch } = props;
  const rawValue = draft[field.key];
  const inputValue = typeof rawValue === "number" ? rawValue : "";

  return (
    <div className="space-y-2">
      <Label htmlFor={field.inputId}>{field.label}</Label>
      <Input
        id={field.inputId}
        type="number"
        value={inputValue}
        onChange={(event) => {
          applyPositiveIntegerPatch(event.target.value, field.key, onPatch);
        }}
      />
    </div>
  );
}

export function ToggleSetting(
  props: Readonly<{
    id: string;
    checked: boolean;
    label: string;
    onCheckedChange: (checked: boolean) => void;
  }>,
) {
  const { id, checked, label, onCheckedChange } = props;

  return (
    <div className="flex items-center gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
