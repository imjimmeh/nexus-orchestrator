import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", days: 7 },
  { label: "Last 30d", days: 30 },
  { label: "This Month", preset: "this-month" as const },
] as const;

export type DateRange = {
  from?: string;
  to?: string;
};

type DateRangePickerProps = {
  value: DateRange;
  onChange: (range: DateRange) => void;
};

function toISODateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

function computeRange(preset: (typeof PRESETS)[number]): DateRange {
  const now = new Date();
  if ("hours" in preset) {
    const from = new Date(now.getTime() - preset.hours * 3600_000);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if ("days" in preset) {
    const from = new Date(now.getTime() - preset.days * 86_400_000);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (preset.preset === "this-month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  return {};
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const activePreset = useMemo(() => {
    if (!value.from && !value.to) return null;
    return PRESETS.find((p) => {
      const computed = computeRange(p);
      return value.from === computed.from && value.to === computed.to;
    });
  }, [value.from, value.to]);

  const handlePreset = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      onChange(computeRange(preset));
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <div className="flex gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            variant={
              activePreset?.label === preset.label ? "default" : "outline"
            }
            size="sm"
            onClick={() => handlePreset(preset)}
            className={cn("h-7 text-xs")}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={value.from ? toISODateString(new Date(value.from)) : ""}
          onChange={(e) =>
            onChange({
              ...value,
              from: e.target.value
                ? new Date(e.target.value).toISOString()
                : undefined,
            })
          }
          className="h-7 rounded-md border bg-background px-2 text-xs"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={value.to ? toISODateString(new Date(value.to)) : ""}
          onChange={(e) =>
            onChange({
              ...value,
              to: e.target.value
                ? new Date(e.target.value).toISOString()
                : undefined,
            })
          }
          className="h-7 rounded-md border bg-background px-2 text-xs"
        />
      </div>
    </div>
  );
}
