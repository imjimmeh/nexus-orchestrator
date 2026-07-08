import { CharterDocument } from "./CharterDocument";

interface ProjectIntentTabProps {
  readonly projectId: string;
  readonly onLaunchRefine: () => void;
}

export function ProjectIntentTab({
  projectId,
  onLaunchRefine,
}: Readonly<ProjectIntentTabProps>) {
  return (
    <div className="pt-4 w-full">
      <CharterDocument projectId={projectId} onLaunchRefine={onLaunchRefine} />
    </div>
  );
}
