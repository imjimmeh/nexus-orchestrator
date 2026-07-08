import type { PermissionDecision } from "@nexus/harness-runtime";

type CheckPermission = (
  toolName: string,
  params: unknown,
) => Promise<PermissionDecision>;

// Mirrors the Claude Agent SDK's runtime `PermissionResult` schema: the `allow`
// branch REQUIRES `updatedInput` (the SDK validates it as a record at runtime,
// even though its `.d.ts` marks it optional) and the `deny` branch REQUIRES a
// `message`. Returning `{ behavior: "allow" }` makes the SDK reject the decision
// with a ZodError ("Tool permission request failed").
type PermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export function buildCanUseTool(checkPermission: CheckPermission) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    _opts: unknown,
  ): Promise<PermissionResult> => {
    const d = await checkPermission(toolName, input);
    if (d.status === "denied")
      return {
        behavior: "deny",
        message: d.reason ?? "Denied by governance policy",
      };
    return { behavior: "allow", updatedInput: input };
  };
}
