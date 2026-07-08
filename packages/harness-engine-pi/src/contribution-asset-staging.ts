/**
 * Stage authored hook scripts as files for injection-safe invocation.
 *
 * When a hook asset carries a `script` (authored `{ language, source }`), the
 * source is written to a temporary file under `stageDir` rather than spliced
 * inline into a shell command string. The generated PI extension then invokes
 * the file via its interpreter (`sh <path>`, `node <path>`, `python3 <path>`),
 * passing the path as a separate argument — never via string concatenation.
 *
 * `command`-bearing hooks are NOT staged here; they are handled inline by the
 * existing `resolveHookCommand` path in `generateHookExtensionSource`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { HarnessHookAsset } from "@nexus/core";
import type { StagedHookKey } from "./contribution-asset-staging.types.js";

export type { StagedHookKey } from "./contribution-asset-staging.types.js";

/** File extension by script language. */
const EXT_BY_LANGUAGE: Record<"bash" | "node" | "python", string> = {
  bash: ".sh",
  node: ".js",
  python: ".py",
};

/**
 * Stage each `script`-bearing hook in `hooks` as a file under `stageDir`.
 *
 * Returns a {@link Map} from a `StagedHookKey` (e.g. `"session_start:1"`) to
 * the absolute path of the staged file. `command`-bearing hooks are skipped
 * and produce no entry in the returned map.
 *
 * Naming: `hook-<event>-<n>.<ext>` where `<n>` is the zero-based index of the
 * hook in the original array. This is deterministic and unique within a session.
 *
 * File permissions: `0o700` on POSIX (the script must be executable by the
 * agent process). On win32 Node's chmod cannot represent Unix permission bits,
 * so the chmod call is skipped (the production runtime is Linux containers).
 */
export function stageHookScripts(
  stageDir: string,
  hooks: HarnessHookAsset[],
): Map<StagedHookKey, string> {
  const staged = new Map<StagedHookKey, string>();

  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    if (!("script" in hook)) continue;

    const { language, source } = hook.script;
    const ext = EXT_BY_LANGUAGE[language];
    const filename = `hook-${hook.event}-${i.toString()}${ext}`;
    const filePath = path.join(stageDir, filename);

    fs.mkdirSync(stageDir, { recursive: true });
    fs.writeFileSync(filePath, source, { encoding: "utf-8" });

    // POSIX-only: set executable permission. On Windows, Node's chmod cannot
    // represent Unix 0o700 and silently toggles only the read-only bit, so we
    // skip to avoid a misleading non-functional call.
    if (process.platform !== "win32") {
      fs.chmodSync(filePath, 0o700);
    }

    const key: StagedHookKey = `${hook.event}:${i.toString()}`;
    staged.set(key, filePath);
  }

  return staged;
}
