import type { CanonicalToolSpec } from "@nexus/harness-runtime";
import type { SdkTool, ToSdkToolOptions } from "./to-sdk-tool.types.js";
import { jsonSchemaToZod } from "./json-schema-to-zod.js";

export type { SdkTool, ToSdkToolOptions } from "./to-sdk-tool.types.js";

interface InvokeResult {
  content: unknown[];
  details?: { ok?: boolean };
  terminate?: boolean;
}

export function toSdkTool(
  spec: CanonicalToolSpec,
  options: ToSdkToolOptions = {},
): SdkTool {
  return {
    name: spec.name,
    description: spec.description,
    // The SDK's `tool()` requires a Zod schema; mounted tools carry JSON
    // Schema (what PI consumes), so convert at the boundary.
    parameters: jsonSchemaToZod(spec.parameters),
    handler: async (input: Record<string, unknown>) => {
      const result = (await spec.invoke(input)) as InvokeResult;

      // A tool may request the turn be durably suspended (executionStatus:
      // suspended → terminate). Signal the engine so it aborts the in-flight
      // query and parks until the awaited children finish. See kanban-atuq.
      if (result?.terminate === true) {
        options.onTerminate?.();
      }

      // The SDK reads `is_error` from the tool result; our ToolCallResult only
      // carries `details.ok`. Without this, API-callback 4xx / {success:false}
      // responses surface as successful tool results (isError:false), so the
      // model and the event ledger never see the failure. See kanban-an5f.
      const isError = result?.details?.ok === false;
      return isError ? { ...result, isError: true } : result;
    },
  };
}
