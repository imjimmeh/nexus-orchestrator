import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
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
import { CreateMcpServerRequest, McpServer } from "@/lib/api/mcp.types";

type Transport = McpServer["transport_type"];

type McpServerFormValues = {
  name: string;
  enabled: boolean;
  transport_type: Transport;
  command: string;
  args: string;
  url: string;
  headersJson: string;
  includeTools: string;
  excludeTools: string;
  timeoutMs: string;
  connectTimeoutMs: string;
  maxRetries: string;
  retryBackoffMs: string;
};

type SetFormValues = Dispatch<SetStateAction<McpServerFormValues>>;

const DEFAULT_FORM_VALUES: McpServerFormValues = {
  name: "",
  enabled: true,
  transport_type: "http" as Transport,
  command: "",
  args: "",
  url: "",
  headersJson: "",
  includeTools: "",
  excludeTools: "",
  timeoutMs: "30000",
  connectTimeoutMs: "10000",
  maxRetries: "2",
  retryBackoffMs: "1000",
};

function setFormField<K extends keyof McpServerFormValues>(
  setFormValues: SetFormValues,
  key: K,
  value: McpServerFormValues[K],
): void {
  setFormValues((previous) => ({
    ...previous,
    [key]: value,
  }));
}

function parseList(raw: string): string[] | undefined {
  const values = raw
    .split(/[\n,]/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : undefined;
}

function parseOptionalInt(raw: string): number | undefined {
  const value = raw.trim();
  if (value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${raw}`);
  }

  return parsed;
}

function stringifyHeaders(headers?: Record<string, string> | null): string {
  if (!headers || Object.keys(headers).length === 0) {
    return "";
  }

  return JSON.stringify(headers, null, 2);
}

function parseHeadersJson(raw: string): Record<string, string> | undefined {
  const value = raw.trim();
  if (value.length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Headers must be a JSON object");
  }

  const normalized: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(parsed)) {
    if (typeof candidate !== "string") {
      throw new Error(`Header '${key}' must be a string`);
    }
    normalized[key] = candidate;
  }

  return normalized;
}

function toFormValues(server: McpServer | null): McpServerFormValues {
  if (!server) {
    return DEFAULT_FORM_VALUES;
  }

  return {
    name: server.name,
    enabled: server.enabled,
    transport_type: server.transport_type,
    command: server.command ?? "",
    args: (server.args ?? []).join(", "),
    url: server.url ?? "",
    headersJson: stringifyHeaders(server.headers),
    includeTools: (server.include_tools ?? []).join(", "),
    excludeTools: (server.exclude_tools ?? []).join(", "),
    timeoutMs: String(server.timeout_ms),
    connectTimeoutMs: String(server.connect_timeout_ms),
    maxRetries: String(server.max_retries),
    retryBackoffMs: String(server.retry_backoff_ms),
  };
}

function buildRequestPayload(
  form: McpServerFormValues,
): CreateMcpServerRequest {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    transport_type: form.transport_type,
    command: form.command.trim() || undefined,
    args: parseList(form.args),
    url: form.url.trim() || undefined,
    headers: parseHeadersJson(form.headersJson),
    include_tools: parseList(form.includeTools),
    exclude_tools: parseList(form.excludeTools),
    timeout_ms: parseOptionalInt(form.timeoutMs),
    connect_timeout_ms: parseOptionalInt(form.connectTimeoutMs),
    max_retries: parseOptionalInt(form.maxRetries),
    retry_backoff_ms: parseOptionalInt(form.retryBackoffMs),
  };
}

function McpIdentityFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: McpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  return (
    <>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="mcp-name">Server Name</Label>
        <Input
          id="mcp-name"
          value={formValues.name}
          onChange={(event) =>
            setFormField(setFormValues, "name", event.target.value)
          }
          placeholder="GitHub MCP"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-transport">Transport</Label>
        <Select
          value={formValues.transport_type}
          onValueChange={(value) =>
            setFormField(setFormValues, "transport_type", value as Transport)
          }
        >
          <SelectTrigger id="mcp-transport">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="stdio">Stdio</SelectItem>
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

function McpTransportFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: McpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  if (formValues.transport_type === ("http" as Transport)) {
    return (
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="mcp-url">HTTP URL</Label>
        <Input
          id="mcp-url"
          value={formValues.url}
          onChange={(event) =>
            setFormField(setFormValues, "url", event.target.value)
          }
          placeholder="http://localhost:4000/mcp"
        />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="mcp-command">Command</Label>
        <Input
          id="mcp-command"
          value={formValues.command}
          onChange={(event) =>
            setFormField(setFormValues, "command", event.target.value)
          }
          placeholder="npx @modelcontextprotocol/server-git"
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="mcp-args">Args (comma or newline)</Label>
        <Textarea
          id="mcp-args"
          value={formValues.args}
          onChange={(event) =>
            setFormField(setFormValues, "args", event.target.value)
          }
          placeholder="--repo, /workspace"
        />
      </div>
    </>
  );
}

function McpOptionsFields({
  formValues,
  setFormValues,
}: Readonly<{
  formValues: McpServerFormValues;
  setFormValues: SetFormValues;
}>) {
  return (
    <>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="mcp-headers">Headers JSON (optional)</Label>
        <Textarea
          id="mcp-headers"
          value={formValues.headersJson}
          onChange={(event) =>
            setFormField(setFormValues, "headersJson", event.target.value)
          }
          placeholder='{"Authorization":"Bearer ..."}'
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-include">Include tools</Label>
        <Input
          id="mcp-include"
          value={formValues.includeTools}
          onChange={(event) =>
            setFormField(setFormValues, "includeTools", event.target.value)
          }
          placeholder="git/*, filesystem/read*"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-exclude">Exclude tools</Label>
        <Input
          id="mcp-exclude"
          value={formValues.excludeTools}
          onChange={(event) =>
            setFormField(setFormValues, "excludeTools", event.target.value)
          }
          placeholder="dangerous/*"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-timeout">Request timeout (ms)</Label>
        <Input
          id="mcp-timeout"
          value={formValues.timeoutMs}
          onChange={(event) =>
            setFormField(setFormValues, "timeoutMs", event.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-connect-timeout">Connect timeout (ms)</Label>
        <Input
          id="mcp-connect-timeout"
          value={formValues.connectTimeoutMs}
          onChange={(event) =>
            setFormField(setFormValues, "connectTimeoutMs", event.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-retries">Max retries</Label>
        <Input
          id="mcp-retries"
          value={formValues.maxRetries}
          onChange={(event) =>
            setFormField(setFormValues, "maxRetries", event.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-backoff">Retry backoff (ms)</Label>
        <Input
          id="mcp-backoff"
          value={formValues.retryBackoffMs}
          onChange={(event) =>
            setFormField(setFormValues, "retryBackoffMs", event.target.value)
          }
        />
      </div>
    </>
  );
}

type McpServerFormDialogProps = {
  open: boolean;
  server: McpServer | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateMcpServerRequest) => Promise<void>;
};

export function McpServerFormDialog({
  open,
  server,
  isSubmitting,
  errorMessage,
  onOpenChange,
  onSubmit,
}: Readonly<McpServerFormDialogProps>) {
  const [formValues, setFormValues] =
    useState<McpServerFormValues>(DEFAULT_FORM_VALUES);
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
          : "Unable to parse MCP server settings",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {server ? "Edit MCP Server" : "Add MCP Server"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <McpIdentityFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <McpTransportFields
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <McpOptionsFields
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
