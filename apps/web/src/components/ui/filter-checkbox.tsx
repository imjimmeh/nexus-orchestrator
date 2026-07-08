import { Checkbox } from "@/components/ui/checkbox";

export interface FilterCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id?: string;
}

function FilterCheckbox({
  checked,
  onCheckedChange,
  label,
  id,
}: Readonly<FilterCheckboxProps>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={label}
      />
      {label}
    </label>
  );
}

export { FilterCheckbox };
