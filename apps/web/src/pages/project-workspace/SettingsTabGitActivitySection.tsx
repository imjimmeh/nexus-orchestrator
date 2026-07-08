import { Label } from "@/components/ui/label";
import { EventLedgerRecord } from "@/lib/api/event-ledger.types";

interface SettingsTabGitActivitySectionProps {
  activity: EventLedgerRecord[];
  isLoading: boolean;
  isError: boolean;
}

function formatDetails(event: EventLedgerRecord): string {
  const payload = event.payload ?? {};
  const candidateKeys = [
    "branchName",
    "sourceBranch",
    "destinationBranch",
    "targetBranch",
    "baseBranch",
    "repositoryUrl",
    "reason",
  ] as const;

  const details = candidateKeys
    .map((key) => {
      const value = payload[key];
      return typeof value === "string" && value.trim().length > 0
        ? `${key}: ${value}`
        : null;
    })
    .filter((value): value is string => value !== null);

  if (details.length > 0) {
    return details.join(" | ");
  }

  if (event.error_message) {
    return event.error_message;
  }

  return "No additional details recorded.";
}

function renderContent(
  activity: EventLedgerRecord[],
  isLoading: boolean,
  isError: boolean,
): React.JSX.Element {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading git activity...</p>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Failed to load git activity.</p>
    );
  }

  if (activity.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No git activity has been recorded for this project yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {activity.map((event) => (
        <div key={event.id} className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs">{event.event_name}</p>
            <p className="text-xs uppercase text-muted-foreground">
              {event.outcome}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(event.occurred_at).toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatDetails(event)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function SettingsTabGitActivitySection({
  activity,
  isLoading,
  isError,
}: Readonly<SettingsTabGitActivitySectionProps>) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <Label>Recent Git Activity</Label>
        <p className="text-xs text-muted-foreground">
          Project-scoped git audit from the backend event ledger. Remote clone
          and push activity appears here when recorded.
        </p>
      </div>
      {renderContent(activity, isLoading, isError)}
    </div>
  );
}