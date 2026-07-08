import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
} from "@/lib/work-items/work-item-filter-options";
import type { WorkItemFilterState } from "./useWorkItemFilters.types";

const ALL = "__all__";

export function WorkItemFilterToolbar({
  filters,
  onChange,
}: Readonly<{
  filters: WorkItemFilterState;
  onChange: (key: keyof WorkItemFilterState, value: string) => void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search work items..."
        value={filters.search ?? ""}
        onChange={(e) => onChange("search", e.target.value)}
        className="h-8 w-56"
        aria-label="Search work items"
      />
      <Select
        value={filters.priority ?? ALL}
        onValueChange={(v) => onChange("priority", v === ALL ? "" : v)}
      >
        <SelectTrigger className="h-8 w-32" aria-label="Filter by priority">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All priorities</SelectItem>
          {WORK_ITEM_PRIORITY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.type ?? ALL}
        onValueChange={(v) => {
          onChange("type", v === ALL ? "" : v);
        }}
      >
        <SelectTrigger className="h-8 w-32" aria-label="Filter by type">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {WORK_ITEM_TYPE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
