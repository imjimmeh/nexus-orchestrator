import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitAuthSecretField } from "@/components/secrets/GitAuthSecretField";
import { useGitOpsBindings, useUpdateGitOpsBinding } from "@/hooks/useGitOps";
import { useSecretOptions } from "@/hooks/useSecretOptions";
import type {
  GitOpsBindingSyncMode,
  GitOpsSyncableObjectType,
} from "@/lib/api/client.gitops.types";
import {
  SYNCABLE_OBJECT_TYPES,
  toggleObjectType,
} from "./gitops-binding.constants";

interface GitOpsBindingEditDialogProps {
  scopeNodeId: string;
  bindingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GitOpsBindingEditDialog({
  scopeNodeId,
  bindingId,
  open,
  onOpenChange,
}: Readonly<GitOpsBindingEditDialogProps>) {
  const { data: bindings, isLoading } = useGitOpsBindings(scopeNodeId);
  const updateBinding = useUpdateGitOpsBinding();
  const secretOptions = useSecretOptions();
  const navigate = useNavigate();
  const binding = bindings?.find((candidate) => candidate.id === bindingId);

  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [defaultRef, setDefaultRef] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [syncMode, setSyncMode] = useState<GitOpsBindingSyncMode>("two_way");
  const [credentialsSecretId, setCredentialsSecretId] = useState<string | null>(
    null,
  );
  const [includedObjectTypes, setIncludedObjectTypes] = useState<
    GitOpsSyncableObjectType[]
  >([]);

  useEffect(() => {
    if (!binding) {
      return;
    }
    setName(binding.name);
    setRepoUrl(binding.repoUrl);
    setDefaultRef(binding.defaultRef);
    setRootPath(binding.rootPath);
    setSyncMode(binding.syncMode);
    setCredentialsSecretId(binding.credentialsSecretId);
    setIncludedObjectTypes(binding.includedObjectTypes);
  }, [binding]);

  const handleSave = () => {
    updateBinding.mutate(
      {
        scopeNodeId,
        bindingId,
        input: {
          name,
          repoUrl,
          defaultRef,
          rootPath,
          syncMode,
          credentialsSecretId,
          includedObjectTypes,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit repository binding</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading binding...
          </div>
        ) : !binding ? (
          <p className="text-sm text-destructive">Binding not found.</p>
        ) : (
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleSave();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="gitops-edit-name">Name</Label>
              <Input
                id="gitops-edit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="gitops-edit-repo-url">Repository URL</Label>
              <Input
                id="gitops-edit-repo-url"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitops-edit-default-ref">Default ref</Label>
              <Input
                id="gitops-edit-default-ref"
                value={defaultRef}
                onChange={(event) => setDefaultRef(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitops-edit-root-path">Root path</Label>
              <Input
                id="gitops-edit-root-path"
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="gitops-edit-sync-mode">Sync mode</Label>
              <select
                id="gitops-edit-sync-mode"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={syncMode}
                onChange={(event) =>
                  setSyncMode(event.target.value as GitOpsBindingSyncMode)
                }
              >
                <option value="git_to_app">git-to-app</option>
                <option value="two_way">two-way</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <GitAuthSecretField
                id="gitops-edit-credentials-secret"
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
            <DialogFooter className="md:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateBinding.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
