import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ProjectOrchestrationMode } from "@/lib/api/projects.types";

interface OrchestrationModeHintProps {
  mode: ProjectOrchestrationMode;
}

export function OrchestrationModeHint({
  mode,
}: Readonly<OrchestrationModeHintProps>) {
  if (mode === "autonomous") {
    return (
      <Alert>
        <AlertTitle>Autonomous Mode</AlertTitle>
        <AlertDescription>
          CEO mutating actions execute immediately and are logged with execution
          status.
        </AlertDescription>
      </Alert>
    );
  }

  if (mode === "supervised") {
    return (
      <Alert>
        <AlertTitle>Supervised Mode</AlertTitle>
        <AlertDescription>
          CEO mutating actions are queued for approval. Use the pending action
          panel to approve or reject each request.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertTitle>Notifications-Only Mode</AlertTitle>
      <AlertDescription>
        CEO mutating actions are denied and recorded as recommendations. No
        automatic orchestration mutation is executed.
      </AlertDescription>
    </Alert>
  );
}
