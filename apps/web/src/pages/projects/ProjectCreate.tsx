import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSecrets } from "@/hooks/useSecrets";
import {
  ProjectGoalsSection,
  RepositorySetupSection,
} from "./ProjectCreate.sections";
import { useProjectCreateForm } from "./useProjectCreateForm";

export function ProjectCreate() {
  const { data: secrets = [] } = useSecrets();
  const form = useProjectCreateForm();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">New Project</h2>
        <p className="text-muted-foreground">
          Create a project and start building your kanban backlog.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {form.lastSavedLabel}
        </p>
      </div>

      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Project Setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Project Name</Label>
            <Input
              value={form.name}
              onChange={(e) => {
                form.setName(e.target.value);
              }}
              placeholder="Project name"
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => {
                form.setDescription(e.target.value);
              }}
              placeholder="Project description"
              className="min-h-[90px]"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="start-onboarding"
              checked={form.startOnboarding}
              onCheckedChange={(checked) => {
                form.setStartOnboarding(checked === true);
              }}
            />
            <Label htmlFor="start-onboarding">
              Start with guided project charter (conversational onboarding)
            </Label>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <ProjectGoalsSection
              goals={form.goals}
              onAddGoal={form.addGoal}
              onRemoveGoal={form.removeGoal}
              onUpdateGoal={form.updateGoal}
              onUpdateGoalMoscow={form.updateGoalMoscow}
              onUpdateGoalPriority={form.updateGoalPriority}
            />
          </div>

          <RepositorySetupSection
            sourceType={form.sourceType}
            setSourceType={form.setSourceType}
            repositoryUrl={form.repositoryUrl}
            setRepositoryUrl={form.setRepositoryUrl}
            basePath={form.basePath}
            setBasePath={form.setBasePath}
            copyToWorkspace={form.copyToWorkspace}
            setCopyToWorkspace={form.setCopyToWorkspace}
            githubSecretId={form.githubSecretId}
            setGithubSecretId={form.setGithubSecretId}
            secrets={secrets.map((secret) => ({
              id: secret.id,
              name: secret.name,
            }))}
          />

          {form.error && (
            <p className="text-sm text-destructive">{form.error}</p>
          )}

          <Button
            onClick={form.submit}
            disabled={!form.name.trim() || form.isSubmitting}
          >
            {form.isSubmitting ? "Creating..." : "Create Project"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
