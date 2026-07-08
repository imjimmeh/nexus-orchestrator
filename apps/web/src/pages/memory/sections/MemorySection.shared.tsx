import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ChatMemoryExplorerSegment,
  MemoryExplorerSegment,
} from "@/lib/api/memory.types";
import { MEMORY_EXPLORER_PAGE_SIZE } from "../MemoryExplorer.requests";
import type { MemoryTypeFilter } from "../MemoryExplorer.types";

interface MemorySegmentTableProps {
  items: MemoryExplorerSegment[];
  total: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  emptyStateMessage: string;
  includeEntityIdColumn?: boolean;
}

interface ChatMemorySegmentTableProps {
  items: ChatMemoryExplorerSegment[];
  total: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  emptyStateMessage: string;
}

interface MemoryFilterBarProps {
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  memoryType: MemoryTypeFilter;
  onMemoryTypeChange: (value: MemoryTypeFilter) => void;
  onSearchSubmit: () => void;
  isLoading: boolean;
  extraControl?: ReactNode;
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

function truncateContent(content: string): string {
  if (content.length <= 180) {
    return content;
  }

  return `${content.slice(0, 180)}...`;
}

export function MemoryFilterBar({
  searchDraft,
  onSearchDraftChange,
  memoryType,
  onMemoryTypeChange,
  onSearchSubmit,
  isLoading,
  extraControl,
}: Readonly<MemoryFilterBarProps>) {
  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_minmax(0,260px)_auto]">
      <Input
        aria-label="Search memory"
        value={searchDraft}
        onChange={(event) => onSearchDraftChange(event.target.value)}
        placeholder="Search memory content"
      />

      <Select
        value={memoryType}
        onValueChange={(value) => onMemoryTypeChange(value as MemoryTypeFilter)}
      >
        <SelectTrigger aria-label="Memory type filter">
          <SelectValue placeholder="Memory type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="fact">Fact</SelectItem>
          <SelectItem value="preference">Preference</SelectItem>
          <SelectItem value="history">History</SelectItem>
        </SelectContent>
      </Select>

      {extraControl}

      <Button onClick={onSearchSubmit} disabled={isLoading}>
        Search
      </Button>
    </div>
  );
}

export function MemorySegmentTable({
  items,
  total,
  offset,
  onOffsetChange,
  emptyStateMessage,
  includeEntityIdColumn = false,
}: Readonly<MemorySegmentTableProps>) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyStateMessage}</p>;
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + MEMORY_EXPLORER_PAGE_SIZE, total);
  const canPrevious = offset > 0;
  const canNext = offset + MEMORY_EXPLORER_PAGE_SIZE < total;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {includeEntityIdColumn ? <TableHead>Entity</TableHead> : null}
            <TableHead>Type</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Content</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((segment) => (
            <TableRow key={segment.id}>
              {includeEntityIdColumn ? (
                <TableCell className="text-xs text-muted-foreground">
                  {segment.entity_id}
                </TableCell>
              ) : null}
              <TableCell className="capitalize">
                {segment.memory_type}
              </TableCell>
              <TableCell>{segment.version.toString()}</TableCell>
              <TableCell className="max-w-[560px] whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {truncateContent(segment.content)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(segment.created_at)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(segment.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          Showing {pageStart.toString()}-{pageEnd.toString()} of{" "}
          {total.toString()}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canPrevious}
            onClick={() => {
              onOffsetChange(Math.max(0, offset - MEMORY_EXPLORER_PAGE_SIZE));
            }}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => {
              onOffsetChange(offset + MEMORY_EXPLORER_PAGE_SIZE);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}

export function ChatMemorySegmentTable({
  items,
  total,
  offset,
  onOffsetChange,
  emptyStateMessage,
}: Readonly<ChatMemorySegmentTableProps>) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyStateMessage}</p>;
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + MEMORY_EXPLORER_PAGE_SIZE, total);
  const canPrevious = offset > 0;
  const canNext = offset + MEMORY_EXPLORER_PAGE_SIZE < total;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Chat Session</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Content</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((segment) => (
            <TableRow key={segment.id}>
              <TableCell className="capitalize">{segment.source}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {segment.profile_id}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {segment.chat_session_id ?? "-"}
              </TableCell>
              <TableCell className="capitalize">
                {segment.memory_type}
              </TableCell>
              <TableCell className="max-w-[560px] whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {truncateContent(segment.content)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(segment.created_at)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(segment.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          Showing {pageStart.toString()}-{pageEnd.toString()} of{" "}
          {total.toString()}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canPrevious}
            onClick={() => {
              onOffsetChange(Math.max(0, offset - MEMORY_EXPLORER_PAGE_SIZE));
            }}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => {
              onOffsetChange(offset + MEMORY_EXPLORER_PAGE_SIZE);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
