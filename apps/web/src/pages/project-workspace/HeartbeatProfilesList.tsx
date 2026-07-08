import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeartbeatProfile } from "@/lib/api/projects.types";
import {
  formatScheduleDate,
  scheduleRunStatusVariant,
} from "./SchedulesTab.helpers";

interface HeartbeatProfilesListProps {
  readonly profiles: HeartbeatProfile[];
  readonly selectedProfileId: string | null;
  readonly isLoading: boolean;
  readonly updatePending: boolean;
  readonly runNowPending: boolean;
  readonly deletePending: boolean;
  readonly onToggleEnabled: (profile: HeartbeatProfile) => void;
  readonly onRunNow: (profileId: string) => void;
  readonly onToggleRuns: (profileId: string) => void;
  readonly onDelete: (profileId: string) => void;
}

function HeartbeatProfilesList({
  profiles,
  selectedProfileId,
  isLoading,
  updatePending,
  runNowPending,
  deletePending,
  onToggleEnabled,
  onRunNow,
  onToggleRuns,
  onDelete,
}: Readonly<HeartbeatProfilesListProps>) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Configured Heartbeat Profiles</p>
        <p className="text-sm text-muted-foreground">
          Loading heartbeat profiles...
        </p>
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Configured Heartbeat Profiles</p>
        <p className="text-sm text-muted-foreground">
          No heartbeat profiles configured for this project.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Configured Heartbeat Profiles</p>
      {profiles.map((profile) => (
        <div key={profile.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={profile.enabled ? "default" : "outline"}>
                  {profile.enabled ? "enabled" : "disabled"}
                </Badge>
                <span className="font-medium">{profile.name}</span>
                {profile.last_run ? (
                  <Badge
                    variant={scheduleRunStatusVariant(profile.last_run.status)}
                  >
                    last run: {profile.last_run.status}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Every {profile.interval_seconds}s • Next run:{" "}
                {formatScheduleDate(profile.next_run_at)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToggleEnabled(profile)}
                disabled={updatePending}
              >
                {profile.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRunNow(profile.id)}
                disabled={runNowPending}
              >
                Run Now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToggleRuns(profile.id)}
              >
                {selectedProfileId === profile.id ? "Hide Runs" : "Show Runs"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(profile.id)}
                disabled={deletePending}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export { HeartbeatProfilesList };
export type { HeartbeatProfilesListProps };
