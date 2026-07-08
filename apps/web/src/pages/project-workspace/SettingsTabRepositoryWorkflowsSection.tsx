import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useRepositoryWorkflowsSection } from "./useRepositoryWorkflowsSection";

interface SettingsTabRepositoryWorkflowsSectionProps {
  projectId: string;
}

export function SettingsTabRepositoryWorkflowsSection({
  projectId,
}: Readonly<SettingsTabRepositoryWorkflowsSectionProps>) {
  const { enabled, overrides, isLoading, toggleEnabled, toggleOverride } =
    useRepositoryWorkflowsSection(projectId);

  const overrideEntries = Object.entries(overrides);

  if (isLoading) {
    return (
      <div className="space-y-2 border-t pt-4">
        <Label>Repository Workflows</Label>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="repo-wf-enabled">Enable Repository Workflows</Label>
          <p className="text-xs text-muted-foreground">
            Automatically register and manage workflows from the repository.
          </p>
        </div>
        <Switch
          id="repo-wf-enabled"
          checked={enabled}
          onCheckedChange={toggleEnabled}
          aria-label="Repository Workflows"
        />
      </div>

      {enabled && overrideEntries.length > 0 && (
        <div className="space-y-3 rounded-md border p-4">
          <Label>Workflow Overrides</Label>
          {overrideEntries.map(([workflowId, override]) => (
            <div key={workflowId} className="flex items-center justify-between">
              <span className="text-sm">{workflowId}</span>
              <Switch
                checked={override.enabled}
                onCheckedChange={(checked) => toggleOverride(workflowId, checked)}
                aria-label={`Toggle ${workflowId}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}