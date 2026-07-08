import { useState } from "react";
import { type UseFormReturn } from "react-hook-form";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderPreset } from "@/lib/api/presets.types";
import { Secret } from "@/lib/api/secrets.types";

export interface FormData {
  name: string;
  provider_id?: string;
  auth_type: "api_key" | "oauth";
  secret_id?: string;
  owner_type?: string;
  owner_id?: string;
  oauth_authorization_url?: string;
  oauth_token_url?: string;
  oauth_client_id?: string;
  oauth_client_secret_id?: string;
  oauth_scopes?: string;
  oauth_redirect_uri?: string;
  runtime_env?: string;
  credential_mode?: "create" | "existing";
  api_key?: string;
  headers?: Array<{ name: string; value: string }>;
  extra_values?: Array<{ name: string; value: string }>;
}

export function isDeviceFlowProvider(
  provider: {
    auth_type?: string;
    oauth_client_id?: string | null;
    runtime_env?: string | Record<string, unknown> | null;
  },
  presets: ProviderPreset[] = [],
): boolean {
  if (provider.auth_type !== "oauth") {
    return false;
  }

  if (provider.oauth_client_id) {
    return false;
  }

  let piProvider = "";
  if (provider.runtime_env) {
    try {
      const env =
        typeof provider.runtime_env === "string"
          ? JSON.parse(provider.runtime_env)
          : provider.runtime_env;
      piProvider = env?.pi_provider || "";
    } catch {
      // ignore
    }
  }

  if (piProvider) {
    const preset = presets.find((p) => p.id === piProvider);
    if (preset && (preset as any).is_device_flow !== undefined) {
      return (preset as any).is_device_flow;
    }
  }

  return !provider.oauth_client_id;
}

const OWNER_TYPE_OPTIONS = [
  { value: "global", label: "Global" },
  { value: "user", label: "User" },
  { value: "scope", label: "Scope" },
];

export function OAuthFields({
  form,
  secrets,
}: Readonly<{
  form: UseFormReturn<FormData>;
  secrets: Secret[];
}>) {
  return (
    <div className="border rounded-md p-4 space-y-4 bg-muted/30">
      <p className="text-sm text-muted-foreground">
        Configure OAuth registration details for this provider. The OAuth Client
        Secret ID references a stored secret&mdash;raw client secrets are never
        exposed.
      </p>

      <FormField
        control={form.control}
        name="oauth_authorization_url"
        render={({ field }) => (
          <FormItem>
            <FormLabel>OAuth Authorization URL</FormLabel>
            <FormControl>
              <Input
                placeholder="https://provider.example/oauth/authorize"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="oauth_token_url"
        render={({ field }) => (
          <FormItem>
            <FormLabel>OAuth Token URL</FormLabel>
            <FormControl>
              <Input
                placeholder="https://provider.example/oauth/token"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="oauth_client_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>OAuth Client ID</FormLabel>
            <FormControl>
              <Input placeholder="client_id" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="oauth_client_secret_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>OAuth Client Secret ID</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select client secret" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {secrets.length === 0 ? (
                  <SelectItem value="no-secrets" disabled>
                    No secrets available
                  </SelectItem>
                ) : (
                  secrets.map((secret) => (
                    <SelectItem key={secret.id} value={secret.id}>
                      {secret.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="oauth_scopes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>OAuth Scopes</FormLabel>
            <FormControl>
              <Input placeholder="openid, profile, email" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="oauth_redirect_uri"
        render={({ field }) => (
          <FormItem>
            <FormLabel>OAuth Redirect URI</FormLabel>
            <FormControl>
              <Input
                placeholder="http://localhost:3120/providers/oauth/callback"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

export function AdvancedSection({
  form,
}: Readonly<{ form: UseFormReturn<FormData> }>) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t pt-2">
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        Advanced (Runtime Environment)
      </button>
      {open && (
        <FormField
          control={form.control}
          name="runtime_env"
          render={({ field }) => (
            <FormItem className="mt-2">
              <FormLabel>Runtime Environment (JSON)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder='{"base_url": "https://api.example.com"}'
                  className="font-mono min-h-[100px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}

export function ProviderBasicFields({
  form,
  presets,
  onPresetChange,
  isDeviceFlow,
}: Readonly<{
  form: UseFormReturn<FormData>;
  presets: ProviderPreset[];
  onPresetChange: (presetId: string) => void;
  isDeviceFlow: boolean;
}>) {
  return (
    <>
      <FormItem>
        <FormLabel>Preset Provider (Optional)</FormLabel>
        <Select onValueChange={onPresetChange} defaultValue="custom">
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder="Custom / Choose preset..." />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectItem value="custom">Custom (Manual Setup)</SelectItem>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name} (
                {preset.auth_type === "oauth" ? "OAuth" : "API Key"})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormItem>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g., OpenAI" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {!isDeviceFlow && (
        <FormField
          control={form.control}
          name="auth_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Auth Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select auth type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="oauth">OAuth</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name="owner_type"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Owner Type</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select owner type" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {OWNER_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="owner_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Owner ID</FormLabel>
            <FormControl>
              <Input placeholder="Owner identifier" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
