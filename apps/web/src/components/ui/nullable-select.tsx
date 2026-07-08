import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NULLABLE_SENTINEL = "__none__";

export interface NullableSelectProps {
  value: string | null | undefined;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

function NullableSelect({
  value,
  onValueChange,
  placeholder = "Select…",
  children,
  disabled,
  className,
}: Readonly<NullableSelectProps>) {
  return (
    <Select
      value={value ?? NULLABLE_SENTINEL}
      onValueChange={(v) => onValueChange(v === NULLABLE_SENTINEL ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NULLABLE_SENTINEL}>{placeholder}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

export { NullableSelect };
