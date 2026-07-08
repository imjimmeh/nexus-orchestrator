import { useEffect, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { ProviderPreset } from "@/lib/api/presets.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { Secret } from "@/lib/api/secrets.types";
import {
  useProviderPresets,
  useProviderOAuthStatus,
} from "@/hooks/useProviders";
import { Badge } from "@/components/ui/badge";
import { DeviceFlowModal } from "./DeviceFlowModal";
import {
  type FormData,
  OAuthFields,
  AdvancedSection,
  ProviderBasicFields,
  isDeviceFlowProvider,
} from "./ProviderFormFields";
import { CredentialSection } from "./CredentialSection";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  provider_id: z.string().optional(),
  auth_type: z.enum(["api_key", "oauth"]),
  secret_id: z.string().optional(),
  owner_type: z.string().optional(),
  owner_id: z.string().optional(),
  oauth_authorization_url: z.string().optional(),
  oauth_token_url: z.string().optional(),
  oauth_client_id: z.string().optional(),
  oauth_client_secret_id: z.string().optional(),
  oauth_scopes: z.string().optional(),
  oauth_redirect_uri: z.string().optional(),
  runtime_env: z.string().optional(),
  credential_mode: z.enum(["create", "existing"]).optional(),
  api_key: z.string().optional(),
  headers: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
  extra_values: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
});

export type ProviderFormData = FormData;

interface ProviderFormProps {
  provider?: LLMProvider;
  secrets: Secret[];
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function getOAuthStatusBadgeVariant(
  status: string,
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

const EMPTY_DEFAULTS: FormData = {
  name: "",
  provider_id: "custom",
  auth_type: "api_key",
  secret_id: "",
  owner_type: "global",
  owner_id: "",
  oauth_authorization_url: "",
  oauth_token_url: "",
  oauth_client_id: "",
  oauth_client_secret_id: "",
  oauth_scopes: "",
  oauth_redirect_uri: "",
  runtime_env: "",
  credential_mode: "create",
  api_key: "",
  headers: [],
  extra_values: [],
};

function extractHeaderPairs(
  runtimeEnv?: Record<string, unknown>,
): Array<{ name: string; value: string }> {
  const config = runtimeEnv?.providerConfig as
    | { headers?: Record<string, string> }
    | undefined;
  const headers = config?.headers ?? {};
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function serializeRuntimeEnv(
  runtimeEnv: Record<string, unknown> | undefined | null,
): string {
  return runtimeEnv ? JSON.stringify(runtimeEnv, null, 2) : "";
}

function computeDefaults(provider?: LLMProvider): FormData {
  if (!provider) return EMPTY_DEFAULTS;
  return {
    name: provider.name,
    provider_id: provider.provider_id ?? "custom",
    auth_type: provider.auth_type,
    secret_id: provider.secret_id ?? "",
    owner_type: provider.owner_type ?? "global",
    owner_id: provider.owner_id ?? "",
    oauth_authorization_url: provider.oauth_authorization_url ?? "",
    oauth_token_url: provider.oauth_token_url ?? "",
    oauth_client_id: provider.oauth_client_id ?? "",
    oauth_client_secret_id: provider.oauth_client_secret_id ?? "",
    oauth_scopes: provider.oauth_scopes?.join(", ") ?? "",
    oauth_redirect_uri: provider.oauth_redirect_uri ?? "",
    runtime_env: serializeRuntimeEnv(provider.runtime_env),
    credential_mode: provider.secret_id ? "existing" : "create",
    api_key: "",
    headers: extractHeaderPairs(
      provider.runtime_env as Record<string, unknown> | undefined,
    ),
    extra_values: [],
  };
}

function applyPreset(
  presetId: string,
  presets: ProviderPreset[],
  form: UseFormReturn<FormData>,
  origin: string,
) {
  if (presetId === "custom") {
    form.setValue("provider_id", "custom");
    return;
  }
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return;

  form.setValue("provider_id", preset.id);
  form.setValue("name", preset.name);
  form.setValue("auth_type", preset.auth_type);

  let envObj: Record<string, unknown> = {};
  const currentEnv = form.getValues("runtime_env");
  if (currentEnv) {
    try {
      envObj = JSON.parse(currentEnv) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  envObj.pi_provider = preset.id;
  form.setValue("runtime_env", JSON.stringify(envObj, null, 2));

  if (preset.auth_type === "oauth") {
    form.setValue(
      "oauth_authorization_url",
      preset.oauth_authorization_url ?? "",
    );
    form.setValue("oauth_token_url", preset.oauth_token_url ?? "");
    form.setValue("oauth_scopes", preset.oauth_scopes?.join(", ") ?? "");
    if (!form.getValues("oauth_redirect_uri")) {
      form.setValue("oauth_redirect_uri", `${origin}/providers/oauth/callback`);
    }
  } else {
    form.setValue("oauth_authorization_url", "");
    form.setValue("oauth_token_url", "");
    form.setValue("oauth_client_id", "");
    form.setValue("oauth_client_secret_id", "");
    form.setValue("oauth_scopes", "");
    form.setValue("oauth_redirect_uri", "");
  }
}

interface DeviceFlowStatusPanelProps {
  provider?: LLMProvider;
  isDeviceFlow: boolean;
  oauthStatus: any;
  onConnect: () => void;
}

function DeviceFlowStatusPanel({
  provider,
  isDeviceFlow,
  oauthStatus,
  onConnect,
}: Readonly<DeviceFlowStatusPanelProps>) {
  if (!isDeviceFlow) return null;

  if (provider) {
    return (
      <div className="border rounded-md p-4 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold">Authentication Status</h4>
            <p className="text-xs text-muted-foreground">
              Authenticate this provider using OAuth Device Code flow.
            </p>
          </div>
          <div>
            {oauthStatus ? (
              <Badge variant={getOAuthStatusBadgeVariant(oauthStatus.status)}>
                {oauthStatus.status.replace("_", " ")}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">
                Checking status...
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={onConnect}>
            {oauthStatus?.status === "connected" ? "Reconnect" : "Connect"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-dashed rounded-md p-4 bg-muted/10 space-y-1">
      <h4 className="text-sm font-semibold text-muted-foreground">
        Device Flow Connection
      </h4>
      <p className="text-xs text-muted-foreground">
        Once you create this provider, click "Edit" to authorize using device
        code.
      </p>
    </div>
  );
}

export function ProviderForm({
  provider,
  secrets,
  onSubmit,
  onCancel,
  isSubmitting,
}: ProviderFormProps) {
  const { data: presets = [] } = useProviderPresets();
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: computeDefaults(provider),
  });

  const showOauth = form.watch("auth_type") === "oauth";
  const [isDeviceFlowOpen, setIsDeviceFlowOpen] = useState(false);
  const { data: oauthStatus } = useProviderOAuthStatus(provider?.id || "");

  const runtimeEnvStr = form.watch("runtime_env") || "";
  const isDeviceFlow = isDeviceFlowProvider(
    {
      auth_type: form.watch("auth_type"),
      oauth_client_id: form.watch("oauth_client_id"),
      runtime_env: runtimeEnvStr,
    },
    presets,
  );

  useEffect(() => {
    if (isDeviceFlow && form.getValues("auth_type") !== "oauth") {
      form.setValue("auth_type", "oauth");
    }
  }, [isDeviceFlow, form]);

  useEffect(() => {
    if (!showOauth) {
      form.setValue("oauth_authorization_url", "");
      form.setValue("oauth_token_url", "");
      form.setValue("oauth_client_id", "");
      form.setValue("oauth_client_secret_id", "");
      form.setValue("oauth_scopes", "");
      form.setValue("oauth_redirect_uri", "");
    }
  }, [showOauth, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <ProviderBasicFields
          form={form}
          presets={presets}
          onPresetChange={(presetId) =>
            applyPreset(presetId, presets, form, window.location.origin)
          }
          isDeviceFlow={isDeviceFlow}
        />

        {!isDeviceFlow && form.watch("auth_type") === "api_key" && (
          <CredentialSection
            form={form}
            secrets={secrets}
            isEdit={Boolean(provider)}
          />
        )}

        {showOauth && !isDeviceFlow && (
          <OAuthFields form={form} secrets={secrets} />
        )}

        <DeviceFlowStatusPanel
          provider={provider}
          isDeviceFlow={isDeviceFlow}
          oauthStatus={oauthStatus}
          onConnect={() => setIsDeviceFlowOpen(true)}
        />

        <AdvancedSection form={form} />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : provider ? "Update" : "Create"}
          </Button>
        </div>
      </form>

      {isDeviceFlowOpen && provider && (
        <DeviceFlowModal
          provider={provider}
          onClose={() => setIsDeviceFlowOpen(false)}
        />
      )}
    </Form>
  );
}
