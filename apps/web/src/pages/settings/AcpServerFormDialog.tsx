import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AcpServer, CreateAcpServerRequest } from "@/lib/api/acp.types";
import { AcpAuthType, AcpAwaitPolicy, AcpRunMode } from "@/lib/api/acp.types";
import {
  buildRequestPayload,
  DEFAULT_FORM_VALUES,
  setFormField,
  toFormValues,
} from "./acp-server-form-dialog.helpers";
import type {
  AcpServerFormValues,
  SetFormValues,
} from "./acp-server-form-dialog.types";

function AcpIdentityFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: AcpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  return (
    <>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="acp-name">Server Name</Label>
        <Input
          id="acp-name"
          value={formValues.name}
          onChange={(event) =>
            setFormField(setFormValues, "name", event.target.value)
          }
          placeholder="Production ACP Server"
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="acp-url">Server URL</Label>
        <Input
          id="acp-url"
          type="url"
          value={formValues.url}
          onChange={(event) =>
            setFormField(setFormValues, "url", event.target.value)
          }
          placeholder="https://acp.example.com"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="acp-auth-type">Auth Type</Label>
        <Select
          value={formValues.auth_type}
          onValueChange={(value) =>
            setFormField(setFormValues, "auth_type", value as AcpAuthType)
          }
        >
          <SelectTrigger id="acp-auth-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="api_key">API Key</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={formValues.enabled}
            onCheckedChange={(checked) =>
              setFormField(
                setFormValues,
                "enabled",
                checked !== false && checked !== "indeterminate",
              )
            }
          />
          Enabled
        </Label>
      </div>
    </>
  );
}

function AcpAuthFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: AcpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  if (formValues.auth_type === AcpAuthType.NONE) {
    return null;
  }

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="acp-auth-token">
        Auth Token (
        {formValues.auth_type === AcpAuthType.BEARER ? "Bearer" : "API Key"})
      </Label>
      <Input
        id="acp-auth-token"
        type="password"
        value={formValues.auth_token}
        onChange={(event) =>
          setFormField(setFormValues, "auth_token", event.target.value)
        }
        placeholder={
          formValues.auth_type === AcpAuthType.BEARER
            ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            : "your-api-key-here"
        }
      />
    </div>
  );
}

function AcpHeadersFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: AcpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="acp-headers">Headers JSON (optional)</Label>
      <Textarea
        id="acp-headers"
        value={formValues.headersJson}
        onChange={(event) =>
          setFormField(setFormValues, "headersJson", event.target.value)
        }
        placeholder='{"X-Custom-Header":"value"}'
        rows={2}
      />
    </div>
  );
}

function AcpAgentFilterFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: AcpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="acp-include">Include Agents</Label>
        <Input
          id="acp-include"
          value={formValues.includeAgents}
          onChange={(event) =>
            setFormField(setFormValues, "includeAgents", event.target.value)
          }
          placeholder="agent-a, agent-b"
        />
        <p className="text-xs text-muted-foreground">
          Comma or newline separated agent names to include
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="acp-exclude">Exclude Agents</Label>
        <Input
          id="acp-exclude"
          value={formValues.excludeAgents}
          onChange={(event) =>
            setFormField(setFormValues, "excludeAgents", event.target.value)
          }
          placeholder="internal-*"
        />
        <p className="text-xs text-muted-foreground">
          Comma or newline separated agent names to exclude
        </p>
      </div>
    </>
  );
}

function AcpTimeoutFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: AcpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="acp-timeout">Request timeout (ms)</Label>
        <Input
          id="acp-timeout"
          value={formValues.timeoutMs}
          onChange={(event) =>
            setFormField(setFormValues, "timeoutMs", event.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="acp-connect-timeout">Connect timeout (ms)</Label>
        <Input
          id="acp-connect-timeout"
          value={formValues.connectTimeoutMs}
          onChange={(event) =>
            setFormField(setFormValues, "connectTimeoutMs", event.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="acp-retries">Max retries</Label>
        <Input
          id="acp-retries"
          value={formValues.maxRetries}
          onChange={(event) =>
            setFormField(setFormValues, "maxRetries", event.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="acp-backoff">Retry backoff (ms)</Label>
        <Input
          id="acp-backoff"
          value={formValues.retryBackoffMs}
          onChange={(event) =>
            setFormField(setFormValues, "retryBackoffMs", event.target.value)
          }
        />
      </div>
    </>
  );
}

function AcpExecutionFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: AcpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="acp-run-mode">Default Run Mode</Label>
        <Select
          value={formValues.default_run_mode}
          onValueChange={(value) =>
            setFormField(setFormValues, "default_run_mode", value as AcpRunMode)
          }
        >
          <SelectTrigger id="acp-run-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sync">Sync</SelectItem>
            <SelectItem value="async">Async</SelectItem>
            <SelectItem value="stream">Stream</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="acp-await-policy">Await Policy</Label>
        <Select
          value={formValues.await_policy}
          onValueChange={(value) =>
            setFormField(setFormValues, "await_policy", value as AcpAwaitPolicy)
          }
        >
          <SelectTrigger id="acp-await-policy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="surface-to-user">Surface to User</SelectItem>
            <SelectItem value="auto-resume">Auto Resume</SelectItem>
            <SelectItem value="fail">Fail</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

type AcpServerFormDialogProps = {
  open: boolean;
  server: AcpServer | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateAcpServerRequest) => Promise<void>;
};

export function AcpServerFormDialog({
  open,
  server,
  isSubmitting,
  errorMessage,
  onOpenChange,
  onSubmit,
}: Readonly<AcpServerFormDialogProps>) {
  const [formValues, setFormValues] =
    useState<AcpServerFormValues>(DEFAULT_FORM_VALUES);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormValues(toFormValues(server));
      setParseError(null);
    }
  }, [open, server]);

  const shownError = parseError ?? errorMessage;

  const handleSubmit = async () => {
    try {
      const payload = buildRequestPayload(formValues);
      await onSubmit(payload);
      setParseError(null);
    } catch (error) {
      setParseError(
        error instanceof Error
          ? error.message
          : "Unable to parse ACP server settings",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {server ? "Edit ACP Server" : "Add ACP Server"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <AcpIdentityFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <AcpAuthFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <AcpHeadersFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <AcpAgentFilterFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <AcpTimeoutFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <AcpExecutionFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
        </div>

        {shownError && <p className="text-sm text-destructive">{shownError}</p>}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
