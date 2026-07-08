import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2, Rocket } from "lucide-react";
import { WorkflowLaunchDialog } from "@/components/workflow/WorkflowLaunchDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { queryKeys } from "@/lib/queryKeys";
import { WorkflowLaunchDescriptor } from "@/lib/api/workflow-launch.types";

interface ProjectWorkflowQuickLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function ProjectWorkflowQuickLaunchDialog({
  open,
  onOpenChange,
  projectId,
}: Readonly<ProjectWorkflowQuickLaunchDialogProps>) {
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowLaunchDescriptor | null>(null);

  const launchOptionsQuery = useQuery({
    queryKey: queryKeys.workflows.launchOptions({ projectId }),
    queryFn: () => api.getWorkflowLaunchOptions({ projectId }),
    enabled: open,
  });

  const sortedOptions = useMemo(
    () =>
      [...(launchOptionsQuery.data ?? [])].sort((left, right) =>
        left.workflowName.localeCompare(right.workflowName),
      ),
    [launchOptionsQuery.data],
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedWorkflow(null);
          }
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Project Workflow Quick Launch</DialogTitle>
            <DialogDescription>
              Launch project-compatible workflows without leaving this
              workspace.
            </DialogDescription>
          </DialogHeader>

          {launchOptionsQuery.isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {launchOptionsQuery.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Unable to load workflow options</AlertTitle>
              <AlertDescription>
                {getApiErrorMessage(
                  launchOptionsQuery.error,
                  "Failed to load project workflow launch options.",
                )}
              </AlertDescription>
            </Alert>
          )}

          {!launchOptionsQuery.isLoading &&
            !launchOptionsQuery.error &&
            sortedOptions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No workflows are available for quick launch.
              </p>
            )}

          {!launchOptionsQuery.isLoading &&
            !launchOptionsQuery.error &&
            sortedOptions.length > 0 && (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {sortedOptions.map((option) => (
                  <div
                    key={option.workflowRowId}
                    className="rounded-md border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold">
                          {option.workflowName}
                        </h4>
                        {option.description && (
                          <p className="text-xs text-muted-foreground">
                            {option.description}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={
                          option.eligibility.eligible ? "default" : "secondary"
                        }
                      >
                        {option.eligibility.eligible ? "Eligible" : "Blocked"}
                      </Badge>
                    </div>

                    {!option.eligibility.eligible && (
                      <p className="text-xs text-muted-foreground">
                        {option.eligibility.reasons
                          .map((reason) => reason.message)
                          .join(" ")}
                      </p>
                    )}

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => setSelectedWorkflow(option)}
                        disabled={!option.eligibility.eligible}
                      >
                        <Rocket className="mr-2 h-4 w-4" />
                        Launch
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedWorkflow && (
        <WorkflowLaunchDialog
          open={!!selectedWorkflow}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setSelectedWorkflow(null);
            }
          }}
          workflowId={selectedWorkflow.workflowRowId}
          workflowName={selectedWorkflow.workflowName}
          fixedProjectId={projectId}
          defaultLaunchSource="project_scoped"
          onLaunched={() => {
            setSelectedWorkflow(null);
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}
