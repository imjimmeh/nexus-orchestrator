/**
 * Helpers for staging plugin files for a Claude Code session.
 *
 * Plugin staging is session-scoped: each plugin gets its own directory under
 * `<agentDir>/plugins/<plugin-name>`. The directory (which may contain a
 * secret-bearing `.mcp.json`) is cleaned up on session dispose via the
 * returned `dispose` function.
 *
 * Uses POSIX path joins throughout because `agentDir` is a container-side POSIX
 * path (e.g. `/agent`) and the Claude Code SDK runs inside a Linux container —
 * using the platform `join` on Windows would produce the wrong separator.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { posix as pathPosix } from "node:path";
import { computeAssetChecksum } from "@nexus/core";
import { mapPluginsToNativeArtifact } from "./plugin-sdk-mappers.js";
import type { HarnessContributions, HarnessPlugin } from "@nexus/core";
import type { DroppedPlugin, StagedPlugins } from "./plugin-staging.types.js";

export type { DroppedPlugin, StagedPlugins } from "./plugin-staging.types.js";

/**
 * Map, stage, and prepare cleanup for all plugins in a contributions bundle.
 *
 * - Defense-in-depth: re-verifies each plugin's checksum over its canonical
 *   `bundle` before staging. A mismatch (or missing bundle) drops that plugin
 *   with a `checksum_mismatch` diagnostic; sibling plugins still stage. Never
 *   throws.
 * - Calls `mapPluginsToNativeArtifact` (pure mapper from Task 2) on the
 *   verified subset.
 * - Writes each output file to disk under `<agentDir>/plugins/<plugin-name>/`.
 * - Returns the `pluginOption` fragment, dropped diagnostics, and a `dispose`
 *   callback that removes the staged dirs on teardown.
 *
 * Empty plugins ⇒ no fs writes, `pluginOption` is `{}` (byte-identical options).
 * Never logs file contents (descriptors may carry resolved secrets).
 */
export async function stagePlugins(
  contributions: HarnessContributions,
  agentDir: string,
): Promise<StagedPlugins> {
  const allPlugins = contributions.plugins ?? [];
  if (allPlugins.length === 0) {
    return { pluginOption: {}, dropped: [], dispose: async () => {} };
  }

  // Re-verify each plugin's checksum before staging (defense-in-depth).
  // A missing bundle gets reason `missing_bundle`; a present bundle whose
  // digest mismatches gets `checksum_mismatch` — distinct signals for operators.
  const dropped: DroppedPlugin[] = [];
  const verified: HarnessPlugin[] = [];
  for (const plugin of allPlugins) {
    if (typeof plugin.bundle !== "string") {
      dropped.push({
        id: plugin.id,
        name: plugin.name,
        reason: "missing_bundle",
      });
    } else if (computeAssetChecksum(plugin.bundle) !== plugin.checksum) {
      dropped.push({
        id: plugin.id,
        name: plugin.name,
        reason: "checksum_mismatch",
      });
    } else {
      verified.push(plugin);
    }
  }

  if (verified.length === 0) {
    return { pluginOption: {}, dropped, dispose: async () => {} };
  }

  const pluginStagingBase = pathPosix.join(agentDir, "plugins");
  const pluginRoots: string[] = [];

  const artifact = mapPluginsToNativeArtifact(verified, {
    rootFor: (p) => {
      const root = pathPosix.join(pluginStagingBase, p.name);
      pluginRoots.push(root);
      return root;
    },
    resolvedMcpServers: contributions.resolvedMcpServers ?? [],
  });

  // Stage plugin files. Paths are root-qualified by `rootFor` above.
  // `.mcp.json` files may carry resolved secrets — never log them.
  for (const file of artifact.files) {
    await mkdir(pathPosix.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, { encoding: "utf-8" });
  }

  return {
    pluginOption: artifact.pluginOption,
    dropped,
    dispose: async () => {
      await Promise.all(
        pluginRoots.map((root) => rm(root, { recursive: true, force: true })),
      );
    },
  };
}
