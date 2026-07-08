import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useBindCredential,
  useCredentialRequirements,
  useUnbindCredential,
} from "@/hooks/useHarnessCredentials";
import { useSecrets } from "@/hooks/useSecrets";
import type {
  CredentialRequirementStatus,
  HarnessAuthType,
} from "@/lib/api/harness-credentials-api.types";

const OAUTH_AUTH_TYPES: readonly HarnessAuthType[] = [
  "oauth_device",
  "oauth_authcode",
];

interface CredentialBindingPanelProps {
  harnessId: string;
  scopeNodeId: string | undefined;
  onStartDeviceFlow: (credentialKey: string) => void;
}

interface RequirementRowProps {
  harnessId: string;
  scopeNodeId: string | undefined;
  requirement: CredentialRequirementStatus;
  onStartDeviceFlow: (credentialKey: string) => void;
}

function RequirementRow({
  harnessId,
  scopeNodeId,
  requirement,
  onStartDeviceFlow,
}: Readonly<RequirementRowProps>) {
  const { data: secrets = [] } = useSecrets();
  const bind = useBindCredential();
  const unbind = useUnbindCredential();
  const [selectedSecretId, setSelectedSecretId] = useState<string | undefined>(
    requirement.boundSecretId,
  );

  const supportsOAuth = requirement.authTypes.some((authType) =>
    OAUTH_AUTH_TYPES.includes(authType),
  );

  async function handleBind() {
    if (!selectedSecretId) {
      return;
    }
    await bind.mutateAsync({
      harnessId,
      key: requirement.key,
      body: {
        authType: "api_key",
        secretId: selectedSecretId,
        scopeNodeId,
      },
    });
  }

  async function handleUnbind() {
    await unbind.mutateAsync({
      harnessId,
      key: requirement.key,
      scopeNodeId,
    });
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{requirement.displayName}</p>
          <p className="text-sm text-muted-foreground font-mono">
            {requirement.key}
          </p>
        </div>
        <Badge variant={requirement.bound ? "default" : "secondary"}>
          {requirement.bound ? "Bound" : "Not bound"}
        </Badge>
      </div>

      <div className="flex items-end gap-2">
        <div className="space-y-1.5 flex-1">
          <Label>Secret</Label>
          <Select value={selectedSecretId} onValueChange={setSelectedSecretId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a secret" />
            </SelectTrigger>
            <SelectContent>
              {secrets.map((secret) => (
                <SelectItem key={secret.id} value={secret.id}>
                  {secret.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleBind}
          disabled={!selectedSecretId || bind.isPending}
        >
          {bind.isPending ? "Binding..." : "Bind"}
        </Button>
      </div>

      <div className="flex gap-2">
        {supportsOAuth && (
          <Button
            variant="outline"
            onClick={() => onStartDeviceFlow(requirement.key)}
          >
            Connect via OAuth
          </Button>
        )}
        {requirement.bound && (
          <Button
            variant="ghost"
            onClick={handleUnbind}
            disabled={unbind.isPending}
          >
            {unbind.isPending ? "Unbinding..." : "Unbind"}
          </Button>
        )}
      </div>
    </div>
  );
}

function CredentialBindingPanel({
  harnessId,
  scopeNodeId,
  onStartDeviceFlow,
}: Readonly<CredentialBindingPanelProps>) {
  const { data, isLoading } = useCredentialRequirements(harnessId, scopeNodeId);
  const requirements = data?.requirements ?? [];

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading credentials...</p>
    );
  }

  if (requirements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This harness declares no credential requirements.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {requirements.map((requirement) => (
        <RequirementRow
          key={requirement.key}
          harnessId={harnessId}
          scopeNodeId={scopeNodeId}
          requirement={requirement}
          onStartDeviceFlow={onStartDeviceFlow}
        />
      ))}
    </div>
  );
}

export { CredentialBindingPanel };
export type { CredentialBindingPanelProps };
