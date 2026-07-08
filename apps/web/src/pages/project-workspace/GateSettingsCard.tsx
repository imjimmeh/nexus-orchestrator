import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export function GateSettingsCard({
  projectId,
}: {
  readonly projectId: string;
}) {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: queryKeys.projects.repositoryWorkflowSettings(projectId),
    queryFn: () => api.getProjectRepositoryWorkflowSettings(projectId),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { enabled: boolean }) =>
      api.updateProjectRepositoryWorkflowSettings(projectId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.repositoryWorkflowSettings(projectId),
      });
    },
  });

  const enabled = settingsQuery.data?.enabled ?? false;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Lifecycle Gates</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <Switch
            aria-label="Enable lifecycle gates"
            checked={enabled}
            disabled={settingsQuery.isLoading || updateMutation.isPending}
            onCheckedChange={(checked) =>
              updateMutation.mutate({ enabled: checked })
            }
          />
        </div>
      </CardHeader>
      {!enabled && !settingsQuery.isLoading ? (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            Lifecycle gates are disabled. Enable to block status transitions
            when workflow checks fail.
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}
