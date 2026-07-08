import { Link } from "react-router-dom";
import { ExternalLink, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "../chat.types";

type SubagentSpawnMetadata = Extract<
  AgentChatMessage["metadata"],
  { type: "subagent_spawn" }
>;

/**
 * Compact card describing a subagent that was spawned by the parent agent,
 * including its status badge and a deep link into the subagent's chat session.
 */
export function SubagentSpawnMessagePart({
  metadata,
}: Readonly<{ metadata: SubagentSpawnMetadata }>) {
  const isTerminal =
    metadata.status === "completed" ||
    metadata.status === "failed" ||
    metadata.status === "cancelled";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-cyan-500/20 bg-cyan-50/30 p-3 dark:bg-cyan-950/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          <span className="font-semibold text-cyan-900 dark:text-cyan-100">
            {metadata.agentProfile}
          </span>
        </div>
        <Badge
          variant={isTerminal ? "secondary" : "default"}
          className={cn(
            "text-[10px] uppercase tracking-wider",
            metadata.status === "running" &&
              "bg-cyan-500 text-white hover:bg-cyan-600",
          )}
        >
          {metadata.status}
        </Badge>
      </div>

      <p className="line-clamp-2 text-xs italic text-muted-foreground">
        "{metadata.taskPrompt || "Spawned for subtask"}"
      </p>

      {metadata.chatSessionId && (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mt-1 h-7 border-cyan-500/30 text-[11px] text-cyan-700 hover:bg-cyan-100 hover:text-cyan-800 dark:text-cyan-300 dark:hover:bg-cyan-900/50 dark:hover:text-cyan-100"
        >
          <Link to={`/sessions/${metadata.chatSessionId}`}>
            Open Session <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      )}
    </div>
  );
}