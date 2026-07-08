import { Label } from "@/components/ui/label";
import { SelectItem } from "@/components/ui/select";
import { NullableSelect } from "@/components/ui/nullable-select";
import { Project } from "@/lib/api/projects.types";

interface NewSessionProjectSelectorProps {
  projectId: string | null;
  onProjectChange: (value: string | null) => void;
  projects: Project[];
  projectsLoading: boolean;
  projectRequired?: boolean;
}

export function NewSessionProjectSelector({
  projectId,
  onProjectChange,
  projects,
  projectsLoading,
  projectRequired,
}: Readonly<NewSessionProjectSelectorProps>) {
  return (
    <div className="space-y-2">
      <Label htmlFor="project">
        Project {projectRequired ? "(required)" : "(optional)"}
      </Label>
      <NullableSelect
        value={projectId}
        onValueChange={onProjectChange}
        placeholder={
          projectsLoading ? "Loading projects..." : "No project (global)"
        }
      >
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </NullableSelect>
      {projectRequired && projectId === null && (
        <p className="text-xs text-destructive">
          A project is required for steering sessions.
        </p>
      )}
    </div>
  );
}
