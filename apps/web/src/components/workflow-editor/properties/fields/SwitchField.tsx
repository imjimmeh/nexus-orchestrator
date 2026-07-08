import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface SwitchFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  id?: string;
}

function SwitchField({
  label,
  checked,
  onChange,
  description,
  id,
}: SwitchFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={fieldId}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <div className="space-y-0.5">
        <Label htmlFor={fieldId} className="cursor-pointer">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

export { SwitchField };
export type { SwitchFieldProps };
