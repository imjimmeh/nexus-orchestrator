import { WorkflowLaunchContractResponse, WorkflowLaunchInputContract } from "@/lib/api/workflow-launch.types";

type ParsedPayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readOptionalString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function sanitizeTriggerDraft(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const next = { ...value };
  delete next._launch;
  return next;
}

function parseJsonDraft(rawJsonDraft: string): ParsedPayloadResult {
  try {
    const parsed = JSON.parse(rawJsonDraft) as unknown;
    if (!isRecord(parsed)) {
      return {
        ok: false,
        message: "Raw JSON payload must be a JSON object.",
      };
    }

    return {
      ok: true,
      payload: parsed,
    };
  } catch {
    return {
      ok: false,
      message: "Raw JSON payload is invalid.",
    };
  }
}

function parseNumberValue(
  label: string,
  trimmed: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const numericValue = Number(trimmed);
  if (!Number.isFinite(numericValue)) {
    return {
      ok: false,
      message: `Field '${label}' must be a valid number.`,
    };
  }

  return {
    ok: true,
    value: numericValue,
  };
}

function parseBooleanValue(
  label: string,
  trimmed: string,
): { ok: true; value: boolean } | { ok: false; message: string } {
  if (trimmed === "true") {
    return {
      ok: true,
      value: true,
    };
  }

  if (trimmed === "false") {
    return {
      ok: true,
      value: false,
    };
  }

  return {
    ok: false,
    message: `Field '${label}' must be true or false.`,
  };
}

function parseJsonInputValue(
  input: WorkflowLaunchInputContract,
  trimmed: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (
      input.type === "string_array" &&
      (!Array.isArray(parsed) ||
        parsed.some((entry) => typeof entry !== "string"))
    ) {
      return {
        ok: false,
        message: `Field '${input.label}' must be a JSON array of strings.`,
      };
    }

    return {
      ok: true,
      value: parsed,
    };
  } catch {
    return {
      ok: false,
      message: `Field '${input.label}' contains invalid JSON.`,
    };
  }
}

function formatBooleanDraft(value: unknown): string {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return "";
}

function formatJsonDraft(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function formatScalarDraft(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function formatDraftValue(
  value: unknown,
  type: WorkflowLaunchInputContract["type"],
): string {
  if (value === undefined || value === null) {
    return "";
  }

  switch (type) {
    case "boolean":
      return formatBooleanDraft(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
    case "json":
    case "string_array":
      return formatJsonDraft(value);
    default:
      return formatScalarDraft(value);
  }
}

export function buildInputDrafts(
  contract: WorkflowLaunchContractResponse,
  triggerDraft: Record<string, unknown>,
): Record<string, string> {
  const drafts: Record<string, string> = {};

  for (const input of contract.contract.inputs) {
    const value = triggerDraft[input.key] ?? input.default;
    drafts[input.key] = formatDraftValue(value, input.type);
  }

  return drafts;
}

function parseStructuredInputValue(
  input: WorkflowLaunchInputContract,
  rawValue: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = rawValue.trim();

  if (trimmed.length === 0) {
    if (input.required) {
      return {
        ok: false,
        message: `Field '${input.label}' is required.`,
      };
    }

    return { ok: true, value: undefined };
  }

  if (input.type === "string") {
    return { ok: true, value: trimmed };
  }

  if (input.type === "number") {
    return parseNumberValue(input.label, trimmed);
  }

  if (input.type === "boolean") {
    return parseBooleanValue(input.label, trimmed);
  }

  if (input.type === "json" || input.type === "string_array") {
    return parseJsonInputValue(input, trimmed);
  }

  return { ok: true, value: trimmed };
}

function buildStructuredPayload(params: {
  contractData: WorkflowLaunchContractResponse;
  inputDrafts: Record<string, string>;
}): ParsedPayloadResult {
  const payload: Record<string, unknown> = {};

  for (const input of params.contractData.contract.inputs) {
    const parsedValue = parseStructuredInputValue(
      input,
      params.inputDrafts[input.key] || "",
    );

    if (!parsedValue.ok) {
      return parsedValue;
    }

    if (parsedValue.value !== undefined) {
      payload[input.key] = parsedValue.value;
    }
  }

  return {
    ok: true,
    payload,
  };
}

export function getContextReasonMessage(
  contract: WorkflowLaunchContractResponse,
): string {
  if (contract.eligibility.reasons.length === 0) {
    return "Workflow launch is currently unavailable for this context.";
  }

  return contract.eligibility.reasons.map((reason) => reason.message).join(" ");
}

export function buildTriggerPayload(params: {
  contractData: WorkflowLaunchContractResponse;
  inputDrafts: Record<string, string>;
  rawJsonEnabled: boolean;
  rawJsonDraft: string;
  selectedProjectId: string;
  workItemId: string;
}): ParsedPayloadResult {
  const payloadResult = params.rawJsonEnabled
    ? parseJsonDraft(params.rawJsonDraft)
    : buildStructuredPayload({
        contractData: params.contractData,
        inputDrafts: params.inputDrafts,
      });

  if (!payloadResult.ok) {
    return payloadResult;
  }

  const payload = { ...payloadResult.payload };

  if (params.selectedProjectId.trim().length > 0) {
    payload.projectId = params.selectedProjectId.trim();
  }

  if (params.workItemId.trim().length > 0) {
    payload.workItemId = params.workItemId.trim();
  }

  return {
    ok: true,
    payload,
  };
}
