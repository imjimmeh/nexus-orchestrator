import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitAuthSecretField } from "@/components/secrets/GitAuthSecretField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateGitOpsBinding } from "@/hooks/useGitOps";
import { useSecretOptions } from "@/hooks/useSecretOptions";
import type {
  GitOpsBindingSyncMode,
  GitOpsSyncableObjectType,
} from "@/lib/api/client.gitops.types";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import {
  SYNCABLE_OBJECT_TYPES,
  toggleObjectType,
} from "./gitops-binding.constants";

interface GitOpsBindingFormProps {
  defaultScopeNodeId?: string;
}

export function GitOpsBindingForm({
  defaultScopeNodeId,
}: GitOpsBindingFormProps) {
  const createBinding = useCreateGitOpsBinding();
  const [scopeNodeId, setScopeNodeId] = useState(
    defaultScopeNodeId ?? GLOBAL_SCOPE_NODE_ID,
  );
  const [name, setName] = useState("platform-config");
  const [repoUrl, setRepoUrl] = useState("");
  const [defaultRef, setDefaultRef] = useState("main");
  const [rootPath, setRootPath] = useState(".");
  const [syncMode, setSyncMode] = useState<GitOpsBindingSyncMode>("two_way");
  const [includedObjectTypes, setIncludedObjectTypes] = useState<
    GitOpsSyncableObjectType[]
  >(["workflow", "agent_profile", "skill"]);
  const secretOptions = useSecretOptions();
  const navigate = useNavigate();
  const [credentialsSecretId, setCredentialsSecretId] = useState<string | null>(
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add repository binding</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            createBinding.mutate({
              scopeNodeId,
              name,
              repoUrl,
              defaultRef,
              rootPath,
              syncMode,
              includedObjectTypes,
              credentialsSecretId,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="gitops-scope-node-id">Scope node id</Label>
            <Input
              id="gitops-scope-node-id"
              value={scopeNodeId}
              onChange={(event) => setScopeNodeId(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gitops-binding-name">Name</Label>
            <Input
              id="gitops-binding-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="gitops-repo-url">Repository URL</Label>
            <Input
              id="gitops-repo-url"
              value={repoUrl}
              placeholder="https://github.com/acme/platform-config.git"
              onChange={(event) => setRepoUrl(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gitops-default-ref">Default ref</Label>
            <Input
              id="gitops-default-ref"
              value={defaultRef}
              onChange={(event) => setDefaultRef(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gitops-root-path">Root path</Label>
            <Input
              id="gitops-root-path"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="gitops-sync-mode">Sync mode</Label>
            <select
              id="gitops-sync-mode"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={syncMode}
              onChange={(event) =>
                setSyncMode(event.target.value as GitOpsBindingSyncMode)
              }
            >
              <option value="git_to_app">git-to-app</option>
              <option value="two_way">two-way</option>
            </select>
            <p className="text-sm text-muted-foreground">
              git-to-app makes Git authoritative. two-way lets app edits become
              pending outbound changes that can be synced back to Git.
            </p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <GitAuthSecretField
              id="gitops-credentials-secret"
              value={credentialsSecretId}
              secrets={secretOptions.secrets}
              secretsError={secretOptions.isError}
              onChange={setCredentialsSecretId}
              onManageSecrets={() => navigate("/secrets")}
              helpText="Select a secret storing HTTPS credentials (username + token) or an SSH private key. Authenticates git fetch/push for private repos. Leave none for public repos."
            />
          </div>
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="text-sm font-medium">Object types</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SYNCABLE_OBJECT_TYPES.map((item) => (
                <label
                  key={item.type}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={includedObjectTypes.includes(item.type)}
                    onChange={() =>
                      setIncludedObjectTypes((current) =>
                        toggleObjectType(current, item.type),
                      )
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="md:col-span-2">
            <Button type="submit" disabled={createBinding.isPending}>
              Add binding
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
