import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { ThreadItem } from "./ThreadItem";
import type { SessionThread } from "./session-thread.types";

interface SessionsThreadPanelProps {
  readonly threads: SessionThread[];
  readonly selectedKey: string | null;
  readonly unreadMap: Map<string, boolean>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly sessionTypeFilter: string;
  readonly onFilterChange: (value: string) => void;
  readonly onSelectThread: (thread: SessionThread) => void;
  readonly onRetry: () => void;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
}

export function SessionsThreadPanel(props: SessionsThreadPanelProps) {
  const {
    threads,
    selectedKey,
    unreadMap,
    loading,
    error,
    search,
    onSearchChange,
    sessionTypeFilter,
    onFilterChange,
    onSelectThread,
    onRetry,
    hasMore = false,
    onLoadMore,
  } = props;

  const filteredThreads = useMemo(() => {
    if (!search.trim()) {
      return threads;
    }

    const lowerSearch = search.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(lowerSearch));
  }, [threads, search]);

  const handleThreadClick = (thread: SessionThread) => {
    onSelectThread(thread);
  };
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isNearBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight < 50;
    if (isNearBottom && hasMore && !loading && onLoadMore) {
      onLoadMore();
    }
  };

  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Conversations</CardTitle>
        <Input
          placeholder="Search sessions and workflows..."
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value);
          }}
        />
        <Select
          value={sessionTypeFilter}
          onValueChange={(value) => {
            onFilterChange(value);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="general">General</SelectItem>
            <SelectItem value="steering">Steering</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent
        className="min-h-0 flex-1 overflow-y-auto space-y-2"
        onScroll={handleScroll}
      >
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error ?? "An error occurred"}</AlertDescription>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onRetry();
              }}
              className="mt-2"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </Alert>
        )}

        {loading && !threads.length && (
          <div className="text-sm text-muted-foreground p-4">
            Loading conversations...
          </div>
        )}

        {!loading && !threads.length && !error && (
          <div className="text-sm text-muted-foreground p-4">
            No active conversations.
          </div>
        )}

        {filteredThreads.map((thread) => {
          const threadKey =
            thread.kind === "chat"
              ? `chat:${thread.id}`
              : `workflow:${thread.id}`;
          const isSelected = selectedKey === threadKey;
          const isUnread = unreadMap.get(threadKey) ?? false;
          return (
            <ThreadItem
              key={threadKey}
              thread={thread}
              isSelected={isSelected}
              isUnread={isUnread}
              onClick={() => {
                handleThreadClick(thread);
              }}
            />
          );
        })}

        {loading && threads.length > 0 && (
          <div className="text-xs text-muted-foreground text-center p-2">
            Loading more...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
