/**
 * SettingsTabBasicProjectFieldsSection owns the basic project identity form:
 * project name, description, repository URL, GitHub auth secret, and local
 * base path. The Save button and feedback line live in the parent
 * orchestrator (`SettingsTab`) so this section remains a self-contained,
 * presentational block of inputs.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GitAuthSecretField } from "@/components/secrets/GitAuthSecretField";
import type { SecretOption } from "@/components/secrets/secret-option.types";

interface SettingsTabBasicProjectFieldsSectionProps {
  name: string;
  description: string;
  repositoryUrl: string;
  basePath: string;
  githubSecretId: string;
  secrets: SecretOption[];
  secretsError: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onRepositoryUrlChange: (value: string) => void;
  onBasePathChange: (value: string) => void;
  onGithubSecretIdChange: (value: string) => void;
  onManageSecrets: () => void;
}

export function SettingsTabBasicProjectFieldsSection({
  name,
  description,
  repositoryUrl,
  basePath,
  githubSecretId,
  secrets,
  secretsError,
  onNameChange,
  onDescriptionChange,
  onRepositoryUrlChange,
  onBasePathChange,
  onGithubSecretIdChange,
  onManageSecrets,
}: Readonly<SettingsTabBasicProjectFieldsSectionProps>) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Project Name</Label>
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Project name"
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="Project description"
          className="min-h-[80px]"
        />
      </div>

      <div className="space-y-2">
        <Label>Repository URL</Label>
        <Input
          value={repositoryUrl}
          onChange={(event) => onRepositoryUrlChange(event.target.value)}
          placeholder="https://github.com/org/repo"
        />
      </div>

      <GitAuthSecretField
        id="settings-github-secret"
        value={githubSecretId || null}
        secrets={secrets}
        secretsError={secretsError}
        onChange={(next) => onGithubSecretIdChange(next ?? "")}
        onManageSecrets={onManageSecrets}
        helpText="GitHub PATs are stored in Secrets as type github_pat."
      />

      <div className="space-y-2">
        <Label>Local Base Path</Label>
        <Input
          value={basePath}
          onChange={(event) => onBasePathChange(event.target.value)}
          placeholder="e.g. . or /repo/path"
        />
      </div>
    </div>
  );
}