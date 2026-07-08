/**
 * Tests for the engine-side checksum re-verify guard in
 * contribution-extension-staging.ts.
 *
 * These tests use real filesystem I/O (temp dirs) and compute checksums via
 * the canonical `computeAssetChecksum` from `@nexus/core` so that
 * the same algorithm drives both the stored value and the re-verify path.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeAssetChecksum } from "@nexus/core";
import type { HarnessExtensionAsset } from "@nexus/core";
import { stageExtensionAssetsWithDiagnostics } from "./contribution-extension-staging.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ext-checksum-test-"));
}

const REAL_BUNDLE = JSON.stringify({
  runtime: "ts-module",
  entry: "src/index.ts",
  moduleSource: "export default function run() {}",
});

function makeValidExt(
  overrides: Partial<HarnessExtensionAsset> = {},
): HarnessExtensionAsset {
  return {
    id: "ext-valid-1",
    name: "valid-ext",
    runtime: "ts-module",
    entry: "src/index.ts",
    source: { kind: "authored" },
    checksum: computeAssetChecksum(REAL_BUNDLE),
    bundle: REAL_BUNDLE,
    moduleSource: "export default function run() {}",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Re-verify guard — mismatch cases
// ---------------------------------------------------------------------------

describe("stageExtensionAssetsWithDiagnostics — checksum re-verify", () => {
  it("refuses to stage an extension whose checksum does not match its bundle", () => {
    const dir = tmpDir();
    const tamperedExt = makeValidExt({
      id: "tampered-1",
      // checksum was computed on something else — now mismatches the bundle
      checksum:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const result = stageExtensionAssetsWithDiagnostics(dir, [tamperedExt]);

    expect(result.stagedPaths).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("tampered-1");
    expect(result.dropped[0].reason).toBe("checksum_mismatch");
    // Ensure no file was written
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("drops a checksum-mismatched asset but stages a valid sibling (never throws)", () => {
    const dir = tmpDir();
    const tampered = makeValidExt({
      id: "tampered-2",
      checksum:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });
    const valid = makeValidExt({ id: "valid-sibling" });

    const result = stageExtensionAssetsWithDiagnostics(dir, [tampered, valid]);

    expect(result.stagedPaths).toHaveLength(1);
    expect(result.stagedPaths[0]).toMatch(/valid-sibling/);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("tampered-2");
    expect(result.dropped[0].reason).toBe("checksum_mismatch");
  });

  it("drops an extension with a missing bundle field with reason missing_bundle", () => {
    const dir = tmpDir();
    const noBundleExt = makeValidExt({ id: "no-bundle-1", bundle: undefined });

    const result = stageExtensionAssetsWithDiagnostics(dir, [noBundleExt]);

    expect(result.stagedPaths).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("no-bundle-1");
    expect(result.dropped[0].reason).toBe("missing_bundle");
  });

  // ---------------------------------------------------------------------------
  // Happy path — matching checksum stages byte-identical
  // ---------------------------------------------------------------------------

  it("stages an extension whose checksum matches the bundle (byte-identical)", () => {
    const dir = tmpDir();
    const ext = makeValidExt({ id: "matched-1" });

    const result = stageExtensionAssetsWithDiagnostics(dir, [ext]);

    expect(result.stagedPaths).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    const written = fs.readFileSync(result.stagedPaths[0], "utf-8");
    expect(written).toBe(ext.moduleSource);
  });
});
