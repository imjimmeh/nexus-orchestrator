import { TextField } from "../fields/TextField";

interface TimeoutFieldProps {
  label: string;
  value: number | undefined | null;
  defaultValueMs: number;
  onChange: (value: number | undefined) => void;
}

function TimeoutField({
  label,
  value,
  defaultValueMs,
  onChange,
}: TimeoutFieldProps) {
  return (
    <TextField
      label={label}
      value={
        value !== null && value !== undefined
          ? String(value)
          : String(defaultValueMs)
      }
      onChange={(v) => onChange(v === "" ? undefined : Number(v))}
      placeholder={String(defaultValueMs)}
    />
  );
}

export { TimeoutField };
