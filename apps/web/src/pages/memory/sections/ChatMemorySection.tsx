import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  useChatMemoryObservability,
  useChatMemorySegments,
} from "@/hooks/useMemoryExplorer";
import type { ChatMemorySource } from "@/lib/api/memory.types";
import type { MemoryTypeFilter } from "../MemoryExplorer.types";
import { ChatMemoryPipelineHealthCard } from "./ChatMemoryPipelineHealthCard";
import {
  ChatMemorySegmentTable,
  MemoryFilterBar,
} from "./MemorySection.shared";

interface ChatMemorySectionProps {
  chatSource: ChatMemorySource;
  chatMemoryType: MemoryTypeFilter;
  chatSearchDraft: string;
  chatProfileIdDraft: string;
  chatSessionIdDraft: string;
  chatIncludeArchived: boolean;
  chatOnlyUndistilled: boolean;
  chatOffset: number;
  chatMemoryQuery: ReturnType<typeof useChatMemorySegments>;
  chatObservabilityQuery: ReturnType<typeof useChatMemoryObservability>;
  chatEmptyStateMessage: string;
  onChatSourceChange: (value: ChatMemorySource) => void;
  onChatMemoryTypeChange: (value: MemoryTypeFilter) => void;
  onChatSearchDraftChange: (value: string) => void;
  onChatProfileIdDraftChange: (value: string) => void;
  onChatSessionIdDraftChange: (value: string) => void;
  onChatIncludeArchivedChange: (value: boolean) => void;
  onChatOnlyUndistilledChange: (value: boolean) => void;
  onChatSearchSubmit: () => void;
  onChatOffsetChange: (offset: number) => void;
}

export function ChatMemorySection({
  chatSource,
  chatMemoryType,
  chatSearchDraft,
  chatProfileIdDraft,
  chatSessionIdDraft,
  chatIncludeArchived,
  chatOnlyUndistilled,
  chatOffset,
  chatMemoryQuery,
  chatObservabilityQuery,
  chatEmptyStateMessage,
  onChatSourceChange,
  onChatMemoryTypeChange,
  onChatSearchDraftChange,
  onChatProfileIdDraftChange,
  onChatSessionIdDraftChange,
  onChatIncludeArchivedChange,
  onChatOnlyUndistilledChange,
  onChatSearchSubmit,
  onChatOffsetChange,
}: Readonly<ChatMemorySectionProps>) {
  const showTable = !chatMemoryQuery.isLoading && !chatMemoryQuery.isError;

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Chat Memory</CardTitle>
          <Badge variant="outline">
            Total {(chatMemoryQuery.data?.total ?? 0).toString()}
          </Badge>
        </div>

        <MemoryFilterBar
          searchDraft={chatSearchDraft}
          onSearchDraftChange={onChatSearchDraftChange}
          memoryType={chatMemoryType}
          onMemoryTypeChange={onChatMemoryTypeChange}
          onSearchSubmit={onChatSearchSubmit}
          isLoading={chatMemoryQuery.isLoading}
          extraControl={
            <Select
              value={chatSource}
              onValueChange={(value) =>
                onChatSourceChange(value as ChatMemorySource)
              }
            >
              <SelectTrigger aria-label="Chat memory source filter">
                <SelectValue placeholder="Chat memory source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profile">Profile (promoted)</SelectItem>
                <SelectItem value="session">Session (raw)</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Input
            aria-label="Chat profile id filter"
            value={chatProfileIdDraft}
            onChange={(event) => onChatProfileIdDraftChange(event.target.value)}
            placeholder="Profile id (optional)"
          />
          <Input
            aria-label="Chat session id filter"
            value={chatSessionIdDraft}
            onChange={(event) => onChatSessionIdDraftChange(event.target.value)}
            placeholder="Chat session id (optional)"
          />

          <Select
            value={chatIncludeArchived ? "true" : "false"}
            onValueChange={(value) =>
              onChatIncludeArchivedChange(value === "true")
            }
          >
            <SelectTrigger aria-label="Include archived filter">
              <SelectValue placeholder="Include archived" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">Exclude archived</SelectItem>
              <SelectItem value="true">Include archived</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={chatOnlyUndistilled ? "true" : "false"}
            onValueChange={(value) =>
              onChatOnlyUndistilledChange(value === "true")
            }
          >
            <SelectTrigger aria-label="Only undistilled filter">
              <SelectValue placeholder="Only undistilled" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">All records</SelectItem>
              <SelectItem value="true">Only undistilled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <ChatMemoryPipelineHealthCard
          chatObservabilityQuery={chatObservabilityQuery}
        />

        {chatMemoryQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading memory...</p>
        ) : null}

        {chatMemoryQuery.isError ? (
          <p className="text-sm text-destructive">
            Unable to load chat memory segments.
          </p>
        ) : null}

        {showTable ? (
          <ChatMemorySegmentTable
            items={chatMemoryQuery.data?.items ?? []}
            total={chatMemoryQuery.data?.total ?? 0}
            offset={chatOffset}
            onOffsetChange={onChatOffsetChange}
            emptyStateMessage={chatEmptyStateMessage}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
