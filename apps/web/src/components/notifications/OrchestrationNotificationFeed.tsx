import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateSafe } from "@/lib/utils";

export type OrchestrationNotificationCategory =
  | "lifecycle"
  | "review"
  | "subagent"
  | "dispatch"
  | "agent_mesh"
  | "war_room";

export interface OrchestrationNotification {
  id: string;
  category: OrchestrationNotificationCategory;
  title: string;
  message: string;
  timestamp: string;
  severity: "info" | "warning" | "error";
}

const FILTERS: Array<OrchestrationNotificationCategory | "all"> = [
  "all",
  "lifecycle",
  "review",
  "subagent",
  "dispatch",
  "agent_mesh",
  "war_room",
];

function getSeverityVariant(severity: OrchestrationNotification["severity"]) {
  if (severity === "error") {
    return "destructive" as const;
  }

  if (severity === "warning") {
    return "default" as const;
  }

  return "secondary" as const;
}

interface OrchestrationNotificationFeedProps {
  items: OrchestrationNotification[];
}

export function OrchestrationNotificationFeed({
  items,
}: Readonly<OrchestrationNotificationFeedProps>) {
  const [filter, setFilter] = useState<
    OrchestrationNotificationCategory | "all"
  >("all");

  const filtered = useMemo(() => {
    if (filter === "all") {
      return items;
    }

    return items.filter((item) => item.category === filter);
  }, [filter, items]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Feed</CardTitle>
        <CardDescription>
          Lifecycle, review, subagent, dispatch, agent mesh, and war-room
          activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={filter === candidate ? "default" : "outline"}
              onClick={() => setFilter(candidate)}
            >
              {candidate}
            </Button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No notifications for this filter.
          </p>
        ) : (
          <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
            {filtered.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <Badge variant={getSeverityVariant(item.severity)}>
                    {item.severity}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{item.message}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{item.category}</Badge>
                  <span>
                    {formatDateSafe(
                      item.timestamp,
                      "MMM d, yyyy HH:mm:ss",
                      "Unknown",
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
