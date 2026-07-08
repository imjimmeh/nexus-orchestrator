import { WorkflowEventsFeed } from "@/components/workflow/WorkflowEventsFeed";

interface EventsTabProps {
  projectId: string;
}

export function EventsTab({ projectId }: Readonly<EventsTabProps>) {
  return (
    <WorkflowEventsFeed
      title="Project Events"
      description="Persisted workflow events for this project, newest first."
      projectId={projectId}
    />
  );
}
