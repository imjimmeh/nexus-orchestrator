import * as fs from "node:fs";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import type { CanonicalToolDefinition } from "../engine/session-context.js";
import { executeApiCallback } from "./api-callback.js";
import type { RunnerLocalToolHandler } from "./mounted-tools.types.js";

export const TOOL_RESULT_CHAR_THRESHOLD = 32_000;
export const TOOL_RESULT_PREVIEW_CHARS = 2_000;
export const TOOL_RESULTS_DIR = ".nexus/tool-results";
/**
 * Per-field budget when pruning an oversized `details` payload. Control fields
 * (ok/action/status/attempt/error_feedback) are small and survive; bulky nested
 * data (e.g. a full Kanban board) is dropped in favour of the on-disk file.
 */
export const TOOL_RESULT_DETAIL_FIELD_CHAR_LIMIT = 4_000;

function serializedSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Drop top-level `details` fields whose serialized form exceeds the per-field
 * budget, leaving small control fields intact and adding pointers to the file
 * holding the full output. Without this the truncated `content` is pointless —
 * the full payload survives in `details` and is still serialized into the
 * model's context window (the cause of CEO-cycle context blow-ups).
 */
function pruneOversizedDetails(
  details: unknown,
  relativePath: string,
): unknown {
  if (
    typeof details !== "object" ||
    details === null ||
    Array.isArray(details)
  ) {
    return details;
  }

  const pruned: Record<string, unknown> = {};
  let removedAny = false;
  for (const [key, value] of Object.entries(details)) {
    if (serializedSize(value) > TOOL_RESULT_DETAIL_FIELD_CHAR_LIMIT) {
      removedAny = true;
      continue;
    }
    pruned[key] = value;
  }

  if (removedAny) {
    pruned.truncated = true;
    pruned.full_output_path = relativePath;
  }
  return pruned;
}

function extractFirstText(content: unknown[]): string | undefined {
  const first = content[0];
  if (
    typeof first === "object" &&
    first !== null &&
    (first as { type?: unknown }).type === "text" &&
    typeof (first as { text?: unknown }).text === "string"
  ) {
    return (first as { text: string }).text;
  }
  return undefined;
}

function buildTruncationPreview(
  text: string,
  relativePath: string,
): { type: "text"; text: string } {
  return {
    type: "text",
    text: [
      `Tool result too large (${text.length.toLocaleString()} chars). Full output written to:`,
      relativePath,
      "",
      `First ${TOOL_RESULT_PREVIEW_CHARS.toLocaleString()} chars of result:`,
      text.slice(0, TOOL_RESULT_PREVIEW_CHARS),
    ].join("\n"),
  };
}

export function ensureResultFits(
  result: unknown,
  workspacePath: string,
  toolName: string,
): unknown {
  if (
    typeof result !== "object" ||
    result === null ||
    !Array.isArray((result as { content?: unknown }).content)
  ) {
    return result;
  }

  const resultWithContent = result as { content: unknown[]; details?: unknown };
  const text = extractFirstText(resultWithContent.content);
  const contentTooLarge =
    text !== undefined && text.length > TOOL_RESULT_CHAR_THRESHOLD;
  const detailsSize =
    resultWithContent.details === undefined
      ? 0
      : serializedSize(resultWithContent.details);

  if (!contentTooLarge && detailsSize <= TOOL_RESULT_CHAR_THRESHOLD) {
    return result;
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const resultsDir = `${workspacePath}/${TOOL_RESULTS_DIR}`;
  fs.mkdirSync(resultsDir, { recursive: true });
  const relativePath = `${TOOL_RESULTS_DIR}/${toolName}_${timestamp}.json`;
  const filePath = `${workspacePath}/${relativePath}`;

  // Persist the largest available representation so nothing is lost on disk.
  const fileBody =
    text !== undefined && text.length >= detailsSize
      ? text
      : JSON.stringify(resultWithContent.details ?? {}, null, 2);
  fs.writeFileSync(filePath, fileBody, "utf-8");

  const content =
    contentTooLarge && text !== undefined
      ? [buildTruncationPreview(text, relativePath)]
      : resultWithContent.content;

  return {
    ...resultWithContent,
    content,
    ...(resultWithContent.details === undefined
      ? {}
      : {
          details: pruneOversizedDetails(
            resultWithContent.details,
            relativePath,
          ),
        }),
  };
}

interface MountedToolApiCallback {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path_template?: string;
  body_mapping?: Record<string, string>;
  external_mcp?: MountedToolExternalMcpCallback;
}

interface MountedToolExternalMcpCallback {
  url: string;
  headers?: Record<string, string>;
  remote_tool_name: string;
}

interface MountedToolMetadata {
  name: string;
  schema: Record<string, unknown>;
  tier: number;
  runtimeOwner?: "api" | "runner";
  transport?: "api_callback" | "runner_local" | "mounted_tool";
  api_callback?: MountedToolApiCallback;
}

type ToolParamsValidator = (params: Record<string, unknown>) => string | null;

type AjvCompatCtor = new (options?: {
  allErrors?: boolean;
  strict?: boolean;
}) => {
  compile: (
    schema: Record<string, unknown>,
  ) => ValidateFunction<Record<string, unknown>>;
};

const AjvCtor = ((Ajv as unknown as { default?: unknown }).default ??
  Ajv) as AjvCompatCtor;

const ajv = new AjvCtor({ allErrors: true, strict: false });

export type { RunnerLocalToolHandler } from "./mounted-tools.types.js";

/**
 * Extract the `export const metadata = {...}` JSON literal from a mounted tool
 * file. Returns null if the metadata cannot be parsed.
 */
export function extractToolMetadata(
  fileContent: string,
): MountedToolMetadata | null {
  const match = /export\s+const\s+metadata\s*=\s*(.+?);?\s*$/ms.exec(
    fileContent,
  );
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      "schema" in parsed &&
      typeof (parsed as MountedToolMetadata).name === "string" &&
      typeof (parsed as MountedToolMetadata).schema === "object"
    ) {
      return parsed as MountedToolMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read mounted tool extension files and convert them to callable ToolDefinitions.
 */
export function loadMountedToolDefinitions(
  extensionsDir: string,
  apiContext?: {
    apiBaseUrl: string;
    agentJwt: string;
    workflowRunId?: string;
    workspacePath?: string;
  },
  runnerLocalHandler?: RunnerLocalToolHandler,
): CanonicalToolDefinition[] {
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(extensionsDir)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts");

  const definitions: CanonicalToolDefinition[] = [];

  for (const file of files) {
    const filePath = `${extensionsDir}/${file}`;
    const content = fs.readFileSync(filePath, "utf-8");
    const metadata = extractToolMetadata(content);

    if (!metadata) {
      console.warn(`Skipping tool at ${filePath}: could not parse metadata`);
      continue;
    }

    const isRunnerLocal =
      metadata.transport === "runner_local" &&
      metadata.runtimeOwner === "runner";

    const isApiCallback = metadata.api_callback && apiContext;
    const validateToolParams = createToolParamsValidator(
      metadata.schema,
      metadata.name,
    );

    const toolDef: CanonicalToolDefinition = {
      name: metadata.name,
      description: buildToolDescription(metadata),
      parameters: metadata.schema,
      async execute(
        _callId: string,
        params: Record<string, unknown>,
      ): Promise<unknown> {
        if (isRunnerLocal) {
          if (runnerLocalHandler) {
            return runnerLocalHandler(metadata.name, params, {
              workflowRunId: apiContext?.workflowRunId,
            });
          }
          return {
            content: [
              {
                type: "text",
                text: `Runner-local tool ${metadata.name} is not available in this harness.`,
              },
            ],
            details: { ok: false, error: "runner_local_not_supported" },
          };
        }

        if (isApiCallback && apiContext && metadata.api_callback) {
          const normalizedParams = repairKnownApiCallbackParams(
            metadata.name,
            normalizeStringifiedValues(params),
          );
          const validationError = validateToolParams(normalizedParams);
          if (validationError) {
            return buildValidationFailureResult(validationError);
          }

          const result = await executeApiCallback({
            toolName: metadata.name,
            callback: {
              method: metadata.api_callback.method,
              path_template: metadata.api_callback.path_template,
              body_mapping: metadata.api_callback.body_mapping,
              external_mcp: metadata.api_callback.external_mcp,
            },
            toolParams: normalizedParams,
            apiBaseUrl: apiContext.apiBaseUrl,
            agentJwt: apiContext.agentJwt,
          });

          if (apiContext.workspacePath) {
            return ensureResultFits(
              result,
              apiContext.workspacePath,
              metadata.name,
            );
          }

          return result;
        }

        return {
          content: [
            {
              type: "text",
              text: `Tool ${metadata.name} executed successfully.`,
            },
          ],
          details: {
            ok: true,
            action: `${metadata.name}_requested`,
            ...params,
          },
        };
      },
    };

    definitions.push(toolDef);
  }

  if (definitions.length > 0) {
    console.log(
      `Loaded ${definitions.length} mounted tool definition(s): ${definitions.map((d) => d.name).join(", ")}`,
    );
  }

  return definitions;
}

function repairKnownApiCallbackParams(
  toolName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== "step_complete") {
    return params;
  }

  const repaired: Record<string, unknown> = {};
  if (typeof params.summary === "string") {
    repaired.summary = params.summary;
  }
  if (typeof params.reasoning === "string") {
    repaired.reasoning = params.reasoning;
  } else if (typeof params.reason === "string") {
    repaired.reasoning = params.reason;
  }
  if (typeof params.status === "string") {
    repaired.status = params.status;
  }

  return repaired;
}

function createToolParamsValidator(
  schema: Record<string, unknown>,
  toolName: string,
): ToolParamsValidator {
  let validate: ValidateFunction<Record<string, unknown>>;

  try {
    validate = ajv.compile(schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Skipping params validation for ${toolName}: invalid schema (${message})`,
    );
    return () => null;
  }

  return (params: Record<string, unknown>) => {
    const valid = validate(params);
    if (valid) {
      return null;
    }

    return formatValidationErrors(validate.errors);
  };
}

function formatValidationErrors(
  errors: ErrorObject[] | null | undefined,
): string {
  if (!errors || errors.length === 0) {
    return "Tool input failed schema validation.";
  }

  return errors
    .map((error) => {
      const path = formatValidationPath(error);
      const message = error.message ?? "is invalid";
      return `${path}: ${message}`;
    })
    .join(", ");
}

function normalizeStringifiedValues(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...params };

  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (
            Array.isArray(parsed) ||
            (typeof parsed === "object" && parsed !== null)
          ) {
            normalized[key] = parsed;
          }
        } catch {
          // Leave invalid JSON strings for the AJV validator to report.
        }
      }
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      normalized[key] = normalizeStringifiedValues(
        value as Record<string, unknown>,
      );
    }
  }

  return normalized;
}

function formatValidationPath(error: ErrorObject): string {
  if (
    error.keyword === "required" &&
    typeof error.params === "object" &&
    error.params !== null &&
    "missingProperty" in error.params &&
    typeof (error.params as { missingProperty?: unknown }).missingProperty ===
      "string"
  ) {
    return (error.params as { missingProperty: string }).missingProperty;
  }

  const instancePath = error.instancePath.replace(/^\/+/, "");
  if (!instancePath) {
    return "(root)";
  }

  return instancePath.replaceAll("/", ".");
}

function buildValidationFailureResult(errorMessage: string): unknown {
  return {
    content: [
      {
        type: "text",
        text: `Validation failed: ${errorMessage}`,
      },
    ],
    details: {
      ok: false,
      error: errorMessage,
    },
  };
}

function buildToolDescription(metadata: MountedToolMetadata): string {
  const schema = metadata.schema;
  const requiredFields = Array.isArray(schema.required)
    ? (schema.required as string[])
    : [];
  const props = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!props) {
    return `Execute the ${metadata.name} tool.`;
  }

  const paramDescriptions = Object.entries(props)
    .map(([key, prop]) => {
      const isRequired = requiredFields.includes(key);
      const desc = prop.description ? ` — ${prop.description as string}` : "";
      return `  ${key}${isRequired ? " (required)" : ""}${desc}`;
    })
    .join("\n");

  return `Execute the ${metadata.name} tool.\n\nParameters:\n${paramDescriptions}`;
}
