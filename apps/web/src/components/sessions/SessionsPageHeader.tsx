import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionsPageHeaderProps {
  readonly onNewSession: () => void;
}

export function SessionsPageHeader(props: SessionsPageHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Unified inbox for chats and workflow conversations
        </p>
      </div>
      <Button onClick={props.onNewSession}>
        <Plus className="h-4 w-4 mr-2" />
        New Session
      </Button>
    </div>
  );
}
