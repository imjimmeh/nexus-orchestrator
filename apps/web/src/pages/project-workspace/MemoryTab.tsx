import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { useProjectMemorySegments } from "@/hooks/useProjectMemory";
import { MemorySegmentType } from "@/lib/api/chat-sessions.types";

const PAGE_SIZE = 25;

interface MemoryTabProps {
  projectId: string;
}

type MemoryTypeFilter = MemorySegmentType | "all";

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

export function MemoryTab({ projectId }: Readonly<MemoryTabProps>) {
  const [memoryType, setMemoryType] = useState<MemoryTypeFilter>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [queryText, setQueryText] = useState("");
  const [offset, setOffset] = useState(0);

  const query = useProjectMemorySegments(projectId, {
    memory_type: memoryType === "all" ? undefined : memoryType,
    query: queryText,
    limit: PAGE_SIZE,
    offset,
  });

  const total = query.data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const canPrevious = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  const emptyStateMessage = useMemo(() => {
    if (queryText.trim().length > 0) {
      return "No memory segments match your current search.";
    }

    return "No project memory segments are available yet.";
  }, [queryText]);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Project Memory</CardTitle>
          <Badge variant="outline">Total {total.toString()}</Badge>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <Input
            aria-label="Search memory"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search memory content"
          />

          <Select
            value={memoryType}
            onValueChange={(value) => {
              const nextValue = value as MemoryTypeFilter;
              setMemoryType(nextValue);
              setOffset(0);
            }}
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

          <Button
            onClick={() => {
              setQueryText(searchDraft.trim());
              setOffset(0);
            }}
            disabled={query.isLoading}
          >
            Search
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading memory...</p>
        ) : null}

        {query.isError ? (
          <p className="text-sm text-destructive">
            Unable to load project memory segments.
          </p>
        ) : null}

        {!query.isLoading && !query.isError ? (
          <>
            {(query.data?.items.length ?? 0) > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Content</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(query.data?.items ?? []).map((segment) => (
                      <TableRow key={segment.id}>
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
                        setOffset(Math.max(0, offset - PAGE_SIZE));
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canNext}
                      onClick={() => {
                        setOffset(offset + PAGE_SIZE);
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {emptyStateMessage}
              </p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
