import type { HarnessHookAsset } from "@nexus/core";

/**
 * Resolve the effective shell command string for a hook asset. For `command`
 * hooks the command string is used directly; for `script` hooks the source is
 * executed inline via the appropriate interpreter.
 *
 * This pure helper is shared between harness engines so the resolution logic
 * stays in one place (DRY).
 */
export function resolveHookCommand(hook: HarnessHookAsset): string {
  if ("command" in hook) {
    return hook.command;
  }
  const { language, source } = hook.script;
  switch (language) {
    case "bash":
      return `bash -c ${JSON.stringify(source)}`;
    case "node":
      return `node -e ${JSON.stringify(source)}`;
    case "python":
      return `python3 -c ${JSON.stringify(source)}`;
  }
}
