import { cn } from "@/lib/utils";
import type { SessionThread } from "./session-thread.types";

interface ThreadItemProps {
  readonly thread: SessionThread;
  readonly isSelected: boolean;
  readonly isUnread: boolean;
  readonly onClick: () => void;
}

export function ThreadItem(props: ThreadItemProps) {
  const { thread, isSelected, isUnread, onClick } = props;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        isSelected
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border hover:bg-muted",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate text-sm">{thread.title}</p>
          {thread.status && (
            <p className="text-xs text-muted-foreground truncate">
              {thread.status}
            </p>
          )}
        </div>
        {isUnread && (
          <div className="h-2 w-2 rounded-full bg-accent-orange flex-shrink-0 mt-1" />
        )}
      </div>
    </button>
  );
}
