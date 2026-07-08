import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useProviderOAuthStatus,
  useInitiateProviderOAuth,
} from "@/hooks/useProviders";
import { ConfigOwnerType, ProviderOAuthStatusValue } from "@/lib/api/common.types";
import { CreateProviderRequest, LLMProvider } from "@/lib/api/providers.types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefreshCw } from "lucide-react";
import { DeviceFlowModal } from "./DeviceFlowModal";
import { isDeviceFlowProvider } from "./ProviderFormFields";
import { type ProviderFormData } from "./ProviderForm";
import { queryKeys } from "@/lib/queryKeys";

export function getSecretName(
  secretId: string | null | undefined,
  secrets: { id: string; name: string }[],
): string {
  if (!secretId) return "-";
  const secret = secrets.find((s) => s.id === secretId);
  return secret?.name || secretId;
}

function getOAuthStatusBadgeVariant(
  status: ProviderOAuthStatusValue,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "connected":
      return "default";
    case "disconnected":
      return "secondary";
    case "expired":
      return "destructive";
    case "not_configured":
    default:
      return "outline";
  }
}

export function OAuthStatusBadge({
  providerId,
}: Readonly<{ providerId: string }>) {
  const { data: oauthStatus, isLoading } = useProviderOAuthStatus(providerId);

  if (isLoading)
    return <span className="text-sm text-muted-foreground">-</span>;
  if (!oauthStatus)
    return <span className="text-sm text-muted-foreground">-</span>;

  return (
    <Badge variant={getOAuthStatusBadgeVariant(oauthStatus.status)}>
      {oauthStatus.status.replace("_", " ")}
    </Badge>
  );
}

function OAuthErrorMessage({ error }: Readonly<{ error: unknown }>) {
  if (!error) return null;
  return (
    <span className="text-xs text-destructive">
      {error instanceof Error ? error.message : "Connection failed"}
    </span>
  );
}

interface OAuthButtonsProps {
  status: string;
  onConnect: () => void;
  isPending: boolean;
}

function OAuthButtons({
  status,
  onConnect,
  isPending,
}: Readonly<OAuthButtonsProps>) {
  const showConnect = status === "not_configured" || status === "disconnected";
  const showReconnect = status === "connected" || status === "expired";

  if (showConnect) {
    return (
      <Button size="sm" onClick={onConnect} disabled={isPending}>
        Connect
      </Button>
    );
  }
  if (showReconnect) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={onConnect}
        disabled={isPending}
      >
        Reconnect
      </Button>
    );
  }
  return null;
}

export function OAuthActions({
  provider,
}: Readonly<{ provider: LLMProvider }>) {
  const queryClient = useQueryClient();
  const { data: oauthStatus } = useProviderOAuthStatus(provider.id);
  const initiateOAuth = useInitiateProviderOAuth();
  const [isDeviceFlowOpen, setIsDeviceFlowOpen] = useState(false);

  const isDeviceFlow = isDeviceFlowProvider(provider);

  const handleConnect = async () => {
    if (isDeviceFlow) {
      setIsDeviceFlowOpen(true);
      return;
    }
    const redirectUri = `${window.location.origin}/providers/oauth/callback`;
    try {
      const result = await initiateOAuth.mutateAsync({
        providerId: provider.id,
        data: { redirect_uri: redirectUri },
      });
      window.location.assign(result.authorizationUrl);
    } catch {
      /* error displayed via render below */
    }
  };

  const handleCheckStatus = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.adminResources.providers.oauthStatus(provider.id),
    });
  };

  const deviceFlowModal = isDeviceFlowOpen ? (
    <DeviceFlowModal
      provider={provider}
      onClose={() => setIsDeviceFlowOpen(false)}
    />
  ) : null;

  if (!oauthStatus) {
    return (
      <>
        {deviceFlowModal}
        <div className="flex items-center gap-2">
          {isDeviceFlow && (
            <Button size="sm" onClick={handleConnect}>
              Connect
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleCheckStatus}>
            <RefreshCw className="mr-1 h-3 w-3" /> Status
          </Button>
          <OAuthErrorMessage error={initiateOAuth.error} />
        </div>
      </>
    );
  }

  return (
    <>
      {deviceFlowModal}
      <div className="flex items-center gap-2">
        <OAuthButtons
          status={oauthStatus.status}
          onConnect={handleConnect}
          isPending={initiateOAuth.isPending}
        />
        <Button size="sm" variant="outline" onClick={handleCheckStatus}>
          <RefreshCw className="mr-1 h-3 w-3" /> Status
        </Button>
        <OAuthErrorMessage error={initiateOAuth.error} />
      </div>
    </>
  );
}

interface ProviderDeleteDialogProps {
  provider: LLMProvider | null;
  error: string | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ProviderDeleteDialog({
  provider,
  error,
  isPending,
  onCancel,
  onConfirm,
}: Readonly<ProviderDeleteDialogProps>) {
  return (
    <AlertDialog open={!!provider} onOpenChange={onCancel}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the provider "{provider?.name}". This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            variant="destructive"
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function parseScopes(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : undefined;
}

function oauthField(
  value: string | undefined,
  isApiKey: boolean,
): string | null {
  if (isApiKey) return null;
  return value || null;
}

function pairsToRecord(
  pairs?: Array<{ name: string; value: string }>,
): Record<string, string> | undefined {
  const entries = (pairs ?? []).filter((p) => p.name.trim().length > 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map((p) => [p.name, p.value]));
}

function buildCredential(
  data: ProviderFormData,
): CreateProviderRequest["credential"] | undefined {
  if (data.auth_type !== "api_key" || data.credential_mode === "existing") {
    return undefined;
  }
  const headers = (data.headers ?? []).filter((h) => h.name.trim().length > 0);
  const extra = pairsToRecord(data.extra_values);
  const apiKey = data.api_key?.trim() ? data.api_key : undefined;
  if (!apiKey && !extra && headers.length === 0) {
    return undefined;
  }
  return {
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(extra ? { extra } : {}),
    ...(headers.length > 0 ? { headers } : {}),
  };
}

export function buildProviderPayload(
  data: ProviderFormData,
): CreateProviderRequest {
  let runtimeEnv = data.runtime_env
    ? (JSON.parse(data.runtime_env) as Record<string, unknown>)
    : undefined;
  const isApiKey = data.auth_type === "api_key";
  const credential = buildCredential(data);
  const useExisting = data.credential_mode === "existing";

  // When using inline credentials, the PairList is the single source of
  // truth for headers — strip any stale copy from the runtime_env blob.
  if (isApiKey && !useExisting) {
    const config = runtimeEnv?.providerConfig as
      | Record<string, unknown>
      | undefined;
    if (config?.headers !== undefined) {
      const restConfig = Object.fromEntries(
        Object.entries(config).filter(([k]) => k !== "headers"),
      );
      runtimeEnv = { ...runtimeEnv, providerConfig: restConfig };
    }
  }

  return {
    name: data.name,
    provider_id: data.provider_id || "custom",
    auth_type: data.auth_type,
    secret_id: useExisting ? data.secret_id || null : null,
    credential,
    runtime_env: runtimeEnv,
    owner_type: (data.owner_type as ConfigOwnerType) || "global",
    owner_id: data.owner_id || null,
    oauth_authorization_url: oauthField(data.oauth_authorization_url, isApiKey),
    oauth_token_url: oauthField(data.oauth_token_url, isApiKey),
    oauth_client_id: oauthField(data.oauth_client_id, isApiKey),
    oauth_client_secret_id: oauthField(data.oauth_client_secret_id, isApiKey),
    oauth_scopes: isApiKey ? null : parseScopes(data.oauth_scopes),
    oauth_redirect_uri: oauthField(data.oauth_redirect_uri, isApiKey),
  };
}
