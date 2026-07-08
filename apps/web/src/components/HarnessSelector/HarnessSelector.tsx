import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HarnessDefinition } from "@/lib/api/harness-api.types";

const INHERIT_VALUE = "__inherit__";

interface HarnessSelectorProps {
  harnesses: Pick<HarnessDefinition, "harnessId" | "displayName">[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  allowInherit?: boolean;
  label?: string;
  disabled?: boolean;
}

function HarnessSelector({
  harnesses,
  value,
  onChange,
  allowInherit = false,
  label = "Harness",
  disabled = false,
}: Readonly<HarnessSelectorProps>) {
  const generatedId = useId();

  function handleValueChange(selected: string) {
    if (selected === INHERIT_VALUE) {
      onChange(undefined);
    } else {
      onChange(selected);
    }
  }

  const selectValue = value ?? (allowInherit ? INHERIT_VALUE : undefined);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={generatedId}>{label}</Label>
      <Select
        value={selectValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger id={generatedId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowInherit && (
            <SelectItem value={INHERIT_VALUE}>Inherit default</SelectItem>
          )}
          {harnesses.map((harness) => (
            <SelectItem key={harness.harnessId} value={harness.harnessId}>
              {harness.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export { HarnessSelector };
export type { HarnessSelectorProps };
