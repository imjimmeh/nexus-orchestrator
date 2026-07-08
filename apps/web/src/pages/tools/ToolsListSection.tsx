import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";
import type { ToolsQueryParams } from "@nexus/core";
import { Tool } from "@/lib/api/tools.types";
import { ToolSourceBadge } from "./ToolSourceBadge";

export type ToolSortField = NonNullable<ToolsQueryParams["sortBy"]>;
export type SortDirection = NonNullable<ToolsQueryParams["sortDir"]>;

export const TOOL_SORT_FIELD = {
  NAME: "name" as ToolSortField,
  TIER: "tier_restriction" as ToolSortField,
} as const;

export const SORT_DIRECTION = {
  ASC: "asc" as SortDirection,
  DESC: "desc" as SortDirection,
} as const;

interface ToolRowsProps {
  isLoading: boolean;
  tools: Tool[];
  onEdit: (tool: Tool) => void;
  onDelete: (tool: Tool) => void;
}

interface SortableHeaderProps {
  label: string;
  field: ToolSortField;
  sortBy: ToolSortField;
  sortDir: SortDirection;
  onSort: (field: ToolSortField) => void;
}

interface ToolsListSectionProps {
  isLoading: boolean;
  tools: Tool[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  sortBy: ToolSortField;
  sortDir: SortDirection;
  onSearchChange: (value: string) => void;
  onSortByChange: (value: ToolSortField) => void;
  onSortDirChange: (value: SortDirection) => void;
  onPageChange: (page: number) => void;
  onEditTool: (tool: Tool) => void;
  onDeleteTool: (tool: Tool) => void;
}

function ToolRows({
  isLoading,
  tools,
  onEdit,
  onDelete,
}: Readonly<ToolRowsProps>) {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-center">
          Loading...
        </TableCell>
      </TableRow>
    );
  }

  if (tools.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-center">
          No tools found
        </TableCell>
      </TableRow>
    );
  }

  return tools.map((tool) => (
    <TableRow key={tool.id}>
      <TableCell className="font-medium">{tool.name}</TableCell>
      <TableCell>
        <ToolSourceBadge source={tool.source} />
      </TableCell>
      <TableCell>
        <Badge variant={tool.tier_restriction === 2 ? "default" : "secondary"}>
          {tool.tier_restriction === 2 ? "heavy (2)" : "light (1)"}
        </Badge>
      </TableCell>
      <TableCell>
        {typeof tool.schema?.type === "string" ? tool.schema.type : "-"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => onEdit(tool)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(tool)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ));
}

function SortableHeader({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
}: Readonly<SortableHeaderProps>) {
  const isActive = sortBy === field;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 font-semibold"
      onClick={() => onSort(field)}
    >
      {label}
      <ArrowUpDown
        className={`ml-1 h-3.5 w-3.5 ${isActive ? "text-foreground" : "text-muted-foreground"} ${isActive && sortDir === SORT_DIRECTION.DESC ? "rotate-180" : ""}`}
      />
    </Button>
  );
}

export function ToolsListSection(props: Readonly<ToolsListSectionProps>) {
  const {
    isLoading,
    tools,
    total,
    page,
    pageSize,
    search,
    sortBy,
    sortDir,
    onSearchChange,
    onEditTool,
    onDeleteTool,
    onPageChange,
  } = props;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  function handleSort(field: ToolSortField) {
    if (field === sortBy) {
      props.onSortDirChange(
        sortDir === SORT_DIRECTION.ASC
          ? SORT_DIRECTION.DESC
          : SORT_DIRECTION.ASC,
      );
    } else {
      props.onSortByChange(field);
      props.onSortDirChange(SORT_DIRECTION.ASC);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search tools..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-xs"
        />
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          {!isLoading && total > 0 && (
            <span>
              {start}–{end} of {total}
            </span>
          )}
          <Button
            variant="outline"
            size="icon"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages - 1}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableHeader
                  label="Name"
                  field={TOOL_SORT_FIELD.NAME}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>Source</TableHead>
              <TableHead>
                <SortableHeader
                  label="Tier"
                  field={TOOL_SORT_FIELD.TIER}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>Schema Type</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <ToolRows
              isLoading={isLoading}
              tools={tools}
              onEdit={onEditTool}
              onDelete={onDeleteTool}
            />
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
