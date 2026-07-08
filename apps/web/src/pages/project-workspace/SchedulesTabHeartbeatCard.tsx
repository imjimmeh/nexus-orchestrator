/**
 * @file SchedulesTabHeartbeatCard.tsx
 *
 * Top-level Heartbeat Checks card for the project workspace Schedules tab.
 * The surface is split into a thin presentation shell that owns the
 * `Card` chrome and three child components — `HeartbeatProfileForm`,
 * `HeartbeatProfilesList`, `HeartbeatRunsHistory` — plus a custom-hook
 * composition in `useSchedulesTabHeartbeatCard.ts` (which itself
 * delegates form state to `useHeartbeatProfileForm`, mutation handlers
 * to `useHeartbeatProfileActions`, and shared types/constants to
 * `SchedulesTabHeartbeatCard.shared.ts`). The shell consumes the hook
 * and composes the children but does not implement data or side-effect
 * logic directly.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeartbeatProfileForm } from "./HeartbeatProfileForm";
import { HeartbeatProfilesList } from "./HeartbeatProfilesList";
import { HeartbeatRunsHistory } from "./HeartbeatRunsHistory";
import {
  useSchedulesTabHeartbeatCard,
  type UseSchedulesTabHeartbeatCardParams,
} from "./useSchedulesTabHeartbeatCard";

type SchedulesTabHeartbeatCardProps = UseSchedulesTabHeartbeatCardParams;

export function SchedulesTabHeartbeatCard({
  projectId,
  workflows,
}: Readonly<SchedulesTabHeartbeatCardProps>) {
  const {
    form,
    formSetters,
    selectedRunsProfileId,
    toggleSelectedRunsProfileId,
    profiles,
    profilesLoading,
    runsLoading,
    runs,
    createPending,
    updatePending,
    runNowPending,
    deletePending,
    handleCreate,
    handleToggleEnabled,
    handleRunNow,
    handleDelete,
  } = useSchedulesTabHeartbeatCard({ projectId, workflows });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heartbeat Checks</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <HeartbeatProfileForm
          state={form}
          workflows={workflows}
          isSaving={createPending}
          setters={formSetters}
          onCreate={() => {
            void handleCreate();
          }}
        />

        <HeartbeatProfilesList
          profiles={profiles}
          selectedProfileId={selectedRunsProfileId}
          isLoading={profilesLoading}
          updatePending={updatePending}
          runNowPending={runNowPending}
          deletePending={deletePending}
          onToggleEnabled={(profile) => {
            void handleToggleEnabled(profile);
          }}
          onRunNow={(profileId) => {
            void handleRunNow(profileId);
          }}
          onToggleRuns={toggleSelectedRunsProfileId}
          onDelete={(profileId) => {
            void handleDelete(profileId);
          }}
        />

        <HeartbeatRunsHistory
          selectedProfileId={selectedRunsProfileId}
          isLoading={runsLoading}
          runs={runs}
        />
      </CardContent>
    </Card>
  );
}
