import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { useSystemMemorySegments } from "@/hooks/useMemoryExplorer";
import type { MemoryTypeFilter } from "../MemoryExplorer.types";
import { MemoryFilterBar, MemorySegmentTable } from "./MemorySection.shared";

interface SystemMemorySectionProps {
  systemMemoryType: MemoryTypeFilter;
  systemSearchDraft: string;
  systemEntityIdDraft: string;
  systemOffset: number;
  systemMemoryQuery: ReturnType<typeof useSystemMemorySegments>;
  systemEmptyStateMessage: string;
  onSystemMemoryTypeChange: (value: MemoryTypeFilter) => void;
  onSystemSearchDraftChange: (value: string) => void;
  onSystemEntityIdDraftChange: (value: string) => void;
  onSystemSearchSubmit: () => void;
  onSystemOffsetChange: (offset: number) => void;
}

export function SystemMemorySection({
  systemMemoryType,
  systemSearchDraft,
  systemEntityIdDraft,
  systemOffset,
  systemMemoryQuery,
  systemEmptyStateMessage,
  onSystemMemoryTypeChange,
  onSystemSearchDraftChange,
  onSystemEntityIdDraftChange,
  onSystemSearchSubmit,
  onSystemOffsetChange,
}: Readonly<SystemMemorySectionProps>) {
  const showTable = !systemMemoryQuery.isLoading && !systemMemoryQuery.isError;

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>System Memory</CardTitle>
          <Badge variant="outline">
            Total {(systemMemoryQuery.data?.total ?? 0).toString()}
          </Badge>
        </div>

        <MemoryFilterBar
          searchDraft={systemSearchDraft}
          onSearchDraftChange={onSystemSearchDraftChange}
          memoryType={systemMemoryType}
          onMemoryTypeChange={onSystemMemoryTypeChange}
          onSearchSubmit={onSystemSearchSubmit}
          isLoading={systemMemoryQuery.isLoading}
          extraControl={
            <Input
              aria-label="System entity id filter"
              value={systemEntityIdDraft}
              onChange={(event) =>
                onSystemEntityIdDraftChange(event.target.value)
              }
              placeholder="Shared entity id (optional)"
            />
          }
        />
      </CardHeader>

      <CardContent className="space-y-3">
        {systemMemoryQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading memory...</p>
        ) : null}

        {systemMemoryQuery.isError ? (
          <p className="text-sm text-destructive">
            Unable to load system memory segments.
          </p>
        ) : null}

        {showTable ? (
          <MemorySegmentTable
            items={systemMemoryQuery.data?.items ?? []}
            total={systemMemoryQuery.data?.total ?? 0}
            offset={systemOffset}
            onOffsetChange={onSystemOffsetChange}
            emptyStateMessage={systemEmptyStateMessage}
            includeEntityIdColumn
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
