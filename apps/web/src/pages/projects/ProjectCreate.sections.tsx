import { GitAuthSecretField } from "@/components/secrets/GitAuthSecretField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProjectGoalMoscow, ProjectGoalPriority } from "@/lib/api/goals.types";

type DraftGoal = {
  id: string;
  title: string;
  description: string;
  moscow: ProjectGoalMoscow | "";
  priority: ProjectGoalPriority | "";
  targetDate: string;
};

export function ProjectGoalsSection(
  props: Readonly<{
    goals: DraftGoal[];
    onAddGoal: () => void;
    onRemoveGoal: (goalId: string) => void;
    onUpdateGoal: (goalId: string, patch: Partial<DraftGoal>) => void;
    onUpdateGoalMoscow: (goalId: string, value: string) => void;
    onUpdateGoalPriority: (goalId: string, value: string) => void;
  }>,
) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Project Goals</Label>
          <p className="text-sm text-muted-foreground">
            Define one or more goals now so orchestration can use them as
            project context.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={props.onAddGoal}>
          Add Goal
        </Button>
      </div>

      {props.goals.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No goals added yet. You can add goals later from the Goals tab.
        </p>
      )}

      <div className="space-y-4">
        {props.goals.map((goal, index) => (
          <div key={goal.id} className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Goal {index + 1}</p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => props.onRemoveGoal(goal.id)}
              >
                Remove
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={goal.title}
                onChange={(event) =>
                  props.onUpdateGoal(goal.id, { title: event.target.value })
                }
                placeholder="Goal title"
              />
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                value={goal.description}
                onChange={(event) =>
                  props.onUpdateGoal(goal.id, {
                    description: event.target.value,
                  })
                }
                placeholder="Describe expected outcome"
                className="min-h-[70px]"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>MoSCoW</Label>
                <Select
                  value={goal.moscow || "__none__"}
                  onValueChange={(value) =>
                    props.onUpdateGoalMoscow(goal.id, value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    <SelectItem value="must">must</SelectItem>
                    <SelectItem value="should">should</SelectItem>
                    <SelectItem value="could">could</SelectItem>
                    <SelectItem value="wont">wont</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={goal.priority || "__none__"}
                  onValueChange={(value) =>
                    props.onUpdateGoalPriority(goal.id, value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    <SelectItem value="p0">p0</SelectItem>
                    <SelectItem value="p1">p1</SelectItem>
                    <SelectItem value="p2">p2</SelectItem>
                    <SelectItem value="p3">p3</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Target Date</Label>
                <Input
                  type="date"
                  value={goal.targetDate}
                  onChange={(event) =>
                    props.onUpdateGoal(goal.id, {
                      targetDate: event.target.value,
                    })
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type ProjectSourceType = "create_new" | "import_local" | "import_remote";

export function RepositorySetupSection(
  props: Readonly<{
    sourceType: ProjectSourceType;
    setSourceType: (mode: ProjectSourceType) => void;
    repositoryUrl: string;
    setRepositoryUrl: (value: string) => void;
    basePath: string;
    setBasePath: (value: string) => void;
    copyToWorkspace: boolean;
    setCopyToWorkspace: (value: boolean) => void;
    githubSecretId: string;
    setGithubSecretId: (value: string) => void;
    secrets: Array<{ id: string; name: string }>;
  }>,
) {
  return (
    <>
      <div className="space-y-2">
        <Label>Project Source</Label>
        <Select
          value={props.sourceType}
          onValueChange={(v) => props.setSourceType(v as ProjectSourceType)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose how to set up your project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="create_new">
              Create new project (initialize empty repository)
            </SelectItem>
            <SelectItem value="import_local">
              Import from local filesystem
            </SelectItem>
            <SelectItem value="import_remote">
              Import from remote repository
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {props.sourceType === "create_new" && (
        <div className="space-y-2">
          <Label>Local Path (optional)</Label>
          <Input
            value={props.basePath}
            onChange={(e) => props.setBasePath(e.target.value)}
            placeholder="e.g. /path/to/new-project or leave empty for default"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to create in the default workspace directory.
          </p>
        </div>
      )}

      {props.sourceType === "import_local" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Local Repository Path</Label>
            <Input
              value={props.basePath}
              onChange={(e) => props.setBasePath(e.target.value)}
              placeholder="e.g. /path/to/existing/repo"
            />
            <p className="text-xs text-muted-foreground">
              Path must be a valid git repository. The original will not be
              modified.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="copy-to-workspace"
              checked={props.copyToWorkspace}
              onCheckedChange={(checked) =>
                props.setCopyToWorkspace(checked === true)
              }
            />
            <Label htmlFor="copy-to-workspace" className="text-sm font-normal">
              Copy repository to workspace (recommended)
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {props.copyToWorkspace
              ? "A copy will be made in the workspace. Changes won't affect the original."
              : "The repository will be used in place. Changes will affect the original directory."}
          </p>
        </div>
      )}

      {props.sourceType === "import_remote" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Repository URL</Label>
            <Input
              value={props.repositoryUrl}
              onChange={(e) => props.setRepositoryUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
            />
          </div>

          <div className="space-y-2">
            <Label>Local Path (optional)</Label>
            <Input
              value={props.basePath}
              onChange={(e) => props.setBasePath(e.target.value)}
              placeholder="e.g. /path/to/existing/checkout"
            />
            <p className="text-xs text-muted-foreground">
              If provided, must be a valid git repository. Leave empty to clone
              into managed workspace.
            </p>
          </div>

          <GitAuthSecretField
            id="project-create-github-secret"
            value={props.githubSecretId || null}
            secrets={props.secrets}
            secretsError={false}
            onChange={(next) => props.setGithubSecretId(next ?? "")}
            label="Git Auth Secret (optional)"
          />
        </div>
      )}
    </>
  );
}
