import { useNavigate } from "react-router-dom";
import { useProject } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RuntimeToolchainsCard } from "./RuntimeToolchainsCard";
import { SettingsTabBasicProjectFieldsSection } from "./SettingsTabBasicProjectFieldsSection";
import { SettingsTabDangerZoneSection } from "./SettingsTabDangerZoneSection";
import { SettingsTabErrorCard } from "./SettingsTabErrorCard";
import { SettingsTabGitActivitySection } from "./SettingsTabGitActivitySection";
import { SettingsTabLoadingCard } from "./SettingsTabLoadingCard";
import { SettingsTabRepositoryWorkflowsSection } from "./SettingsTabRepositoryWorkflowsSection";
import { useSecretOptions } from "@/hooks/useSecretOptions";
import { useGitActivity } from "./useGitActivity";
import { useProjectSettingsMutations } from "./useProjectSettingsMutations";
import { useRuntimeToolchainsValue } from "./useRuntimeToolchainsValue";
import { useSettingsFormState } from "./useSettingsFormState";

interface SettingsTabProps {
  projectId: string;
}

export function SettingsTab({ projectId }: Readonly<SettingsTabProps>) {
  const navigate = useNavigate();
  const projectQuery = useProject(projectId);
  const { data: project, isLoading } = projectQuery;

  const form = useSettingsFormState(project);
  const secrets = useSecretOptions();
  const gitActivity = useGitActivity(projectId);
  const { value: runtimeToolchains } = useRuntimeToolchainsValue(project);
  const mutations = useProjectSettingsMutations(projectId);

  const handleSave = () => {
    mutations.saveProject({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      repositoryUrl: form.repositoryUrl.trim() || undefined,
      basePath: form.basePath.trim() || undefined,
      githubSecretId: form.githubSecretId.trim(),
    });
  };

  if (isLoading) {
    return <SettingsTabLoadingCard />;
  }

  if (projectQuery.isError) {
    return <SettingsTabErrorCard onRetry={() => void projectQuery.refetch()} />;
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Project Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingsTabBasicProjectFieldsSection
          name={form.name}
          description={form.description}
          repositoryUrl={form.repositoryUrl}
          basePath={form.basePath}
          githubSecretId={form.githubSecretId}
          secrets={secrets.secrets}
          secretsError={secrets.isError}
          onNameChange={form.setName}
          onDescriptionChange={form.setDescription}
          onRepositoryUrlChange={form.setRepositoryUrl}
          onBasePathChange={form.setBasePath}
          onGithubSecretIdChange={form.setGithubSecretId}
          onManageSecrets={() => navigate("/secrets")}
        />

        {mutations.feedback && (
          <p className="text-sm text-muted-foreground">{mutations.feedback}</p>
        )}

        <Button
          onClick={handleSave}
          disabled={!form.name.trim() || mutations.isSaving}
        >
          {mutations.isSaving ? "Saving..." : "Save Settings"}
        </Button>

        <SettingsTabRepositoryWorkflowsSection projectId={projectId} />

        <RuntimeToolchainsCard
          value={runtimeToolchains}
          onSave={mutations.saveRuntimeToolchains}
        />

        <SettingsTabGitActivitySection
          activity={gitActivity.activity}
          isLoading={gitActivity.isLoading}
          isError={gitActivity.isError}
        />

        <SettingsTabDangerZoneSection
          isDeleting={mutations.isDeleting}
          deleteDialogOpen={mutations.deleteDialogOpen}
          onDeleteDialogOpenChange={mutations.setDeleteDialogOpen}
          onConfirmDelete={() => void mutations.confirmDeleteProject()}
        />
      </CardContent>
    </Card>
  );
}
