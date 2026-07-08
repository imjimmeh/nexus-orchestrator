/**
 * Tests for the engine-side checksum re-verify guard in plugin-staging.ts.
 *
 * A plugin whose stored `checksum` does not match `computeAssetChecksum(bundle)`
 * must be dropped (no files written) with a `checksum_mismatch` diagnostic;
 * sibling valid plugins must still stage.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readdir, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { computeAssetChecksum } from "@nexus/core";
import type { HarnessPlugin } from "@nexus/core";
import { stagePlugins } from "./plugin-staging.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REAL_BUNDLE = JSON.stringify({
  capabilities: {},
  manifest: { name: "test-plugin" },
});

function makePlugin(overrides: Partial<HarnessPlugin> = {}): HarnessPlugin {
  return {
    id: "plugin-1",
    name: "test-plugin",
    version: "1.0.0",
    source: { kind: "authored" },
    checksum: computeAssetChecksum(REAL_BUNDLE),
    bundle: REAL_BUNDLE,
    capabilities: {},
    manifest: { name: "test-plugin" },
    ...overrides,
  };
}

const tmpDirs: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `plugin-checksum-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

// ---------------------------------------------------------------------------
// Re-verify guard — mismatch
// ---------------------------------------------------------------------------

describe("stagePlugins — checksum re-verify", () => {
  it("does not stage a plugin whose checksum mismatches its bundle", async () => {
    const agentDir = await tmpDir();
    const tampered = makePlugin({
      id: "tampered-plugin",
      checksum:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });

    const { pluginOption, dispose, dropped } = await stagePlugins(
      { plugins: [tampered], resolvedMcpServers: [] },
      agentDir,
    );
    await dispose();

    expect(dropped).toHaveLength(1);
    expect(dropped[0].id).toBe("tampered-plugin");
    expect(dropped[0].reason).toBe("checksum_mismatch");
    // No plugin directory should have been created
    expect(pluginOption).toEqual({});
    const entries = await readdir(agentDir);
    expect(entries).toHaveLength(0);
  });

  it("drops a mismatched plugin but stages a valid sibling", async () => {
    const agentDir = await tmpDir();
    const tampered = makePlugin({
      id: "tampered-plugin-2",
      name: "tampered",
      checksum:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const valid = makePlugin({ id: "valid-plugin-1", name: "valid-plugin" });

    const { pluginOption, dispose, dropped } = await stagePlugins(
      { plugins: [tampered, valid], resolvedMcpServers: [] },
      agentDir,
    );
    await dispose();

    expect(dropped).toHaveLength(1);
    expect(dropped[0].id).toBe("tampered-plugin-2");
    expect(dropped[0].reason).toBe("checksum_mismatch");
    // The valid plugin is still staged
    expect((pluginOption as { plugins?: unknown[] }).plugins).toHaveLength(1);
  });

  it("drops a plugin with missing bundle with reason missing_bundle", async () => {
    const agentDir = await tmpDir();
    const noBundle = makePlugin({ id: "no-bundle-plugin", bundle: undefined });

    const { dispose, dropped } = await stagePlugins(
      { plugins: [noBundle], resolvedMcpServers: [] },
      agentDir,
    );
    await dispose();

    expect(dropped).toHaveLength(1);
    expect(dropped[0].id).toBe("no-bundle-plugin");
    expect(dropped[0].reason).toBe("missing_bundle");
  });

  // ---------------------------------------------------------------------------
  // Happy path — matching checksum stages normally
  // ---------------------------------------------------------------------------

  it("stages a plugin whose checksum matches its bundle", async () => {
    const agentDir = await tmpDir();
    const valid = makePlugin({ id: "valid-matching", name: "valid-plugin" });

    const { pluginOption, dispose, dropped } = await stagePlugins(
      { plugins: [valid], resolvedMcpServers: [] },
      agentDir,
    );
    await dispose();

    expect(dropped).toHaveLength(0);
    expect((pluginOption as { plugins?: unknown[] }).plugins).toHaveLength(1);
  });
});
