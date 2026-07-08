import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { FilterDef } from "./data-table.types";

interface DataTableToolbarProps {
  searchInput: string;
  onSearch: (value: string) => void;
  filters?: FilterDef[];
  filterValues: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
}

function MultiSelectFilter({
  filter,
  value,
  onChange,
}: Readonly<{
  filter: FilterDef;
  value: string;
  onChange: (value: string) => void;
}>) {
  const selected = new Set(value ? value.split(",") : []);

  function toggle(optionValue: string) {
    const next = new Set(selected);
    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }
    onChange([...next].join(","));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[160px] justify-start">
          {filter.label}
          {selected.size > 0 ? ` (${String(selected.size)})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2">
        {filter.options.map((option) => (
          <div key={option.value} className="flex items-center gap-2">
            <Checkbox
              id={`${filter.key}-${option.value}`}
              checked={selected.has(option.value)}
              onCheckedChange={() => {
                toggle(option.value);
              }}
            />
            <Label htmlFor={`${filter.key}-${option.value}`}>
              {option.label}
            </Label>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function DateRangeFilter({
  filter,
  filterValues,
  onFilterChange,
}: Readonly<{
  filter: FilterDef;
  filterValues: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
}>) {
  const toKey = `${filter.key}_to`;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${filter.key}-from`}>{filter.label} from</Label>
        <Input
          id={`${filter.key}-from`}
          type="date"
          value={filterValues[filter.key] ?? ""}
          onChange={(e) => {
            onFilterChange(filter.key, e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${filter.key}-to`}>{filter.label} to</Label>
        <Input
          id={`${filter.key}-to`}
          type="date"
          value={filterValues[toKey] ?? ""}
          onChange={(e) => {
            onFilterChange(toKey, e.target.value);
          }}
        />
      </div>
    </div>
  );
}

export function DataTableToolbar({
  searchInput,
  onSearch,
  filters,
  filterValues,
  onFilterChange,
}: DataTableToolbarProps) {
  const [localSearch, setLocalSearch] = useState(searchInput);

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, onSearch]);

  useEffect(() => {
    setLocalSearch(searchInput);
  }, [searchInput]);

  return (
    <div className="flex flex-wrap items-center gap-3 py-4">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      {filters
        ?.filter((filter) => !filter.key.endsWith("_to"))
        .map((filter) => {
          if (filter.type === "multiselect") {
            return (
              <MultiSelectFilter
                key={filter.key}
                filter={filter}
                value={filterValues[filter.key] ?? ""}
                onChange={(value) => {
                  onFilterChange(filter.key, value);
                }}
              />
            );
          }
          if (filter.type === "date") {
            return (
              <DateRangeFilter
                key={filter.key}
                filter={filter}
                filterValues={filterValues}
                onFilterChange={onFilterChange}
              />
            );
          }
          return (
            <Select
              key={filter.key}
              value={filterValues[filter.key] ?? "__all__"}
              onValueChange={(value) => onFilterChange(filter.key, value)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={filter.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All {filter.label}</SelectItem>
                {filter.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
    </div>
  );
}
