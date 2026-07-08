/**
 * Tests for contribution-extension-staging.ts that simulate FS write failures.
 *
 * node:fs is fully mocked in this file so that writeFileSync can be made to
 * throw, proving the `stage_write_failed` drop path without needing a special
 * OS-level failure condition.
 *
 * Real-filesystem tests live in contribution-extension-staging.spec.ts.
 *
 * IMPORTANT: vi.mock factories are hoisted to the top of the module and run
 * before any `const` declarations in the test file. Functions referenced
 * inside the factory must be defined inline (not via outer `const` variables).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessExtensionAsset } from "@nexus/core";

// ---------------------------------------------------------------------------
// Mock node:fs — hoisted before any import resolves.
// mkdirSync and writeFileSync are exposed as named exports so tests can
// configure their behaviour per-test via vi.mocked().
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => {
  const mkdirSync = vi.fn();
  const writeFileSync = vi.fn();
  const unlinkSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(false);
  return {
    default: { mkdirSync, writeFileSync, unlinkSync, existsSync },
    mkdirSync,
    writeFileSync,
    unlinkSync,
    existsSync,
  };
});

// Import the module AFTER vi.mock is declared (hoisting ensures mock is active).
const { stageExtensionAssetsWithDiagnostics } =
  await import("./contribution-extension-staging.js");
const { computeAssetChecksum } = await import("@nexus/core");

// Grab the mocked fs so tests can configure individual calls.
const { default: fs } = await import("node:fs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ts-module ext with a canonical bundle + matching checksum so that the
 * checksum re-verify guard passes and the test can isolate the write-failure path.
 */
function makeTsModuleExt(
  overrides: Partial<HarnessExtensionAsset> = {},
): HarnessExtensionAsset {
  const moduleSource =
    overrides.moduleSource ?? "export default function run() {}";
  const bundle = JSON.stringify({
    runtime: "ts-module",
    entry: "src/index.ts",
    moduleSource,
  });
  const checksum = computeAssetChecksum(bundle);
  return {
    id: "ext-uuid-1",
    name: "my-ext",
    runtime: "ts-module",
    entry: "src/index.ts",
    source: { kind: "authored" },
    checksum,
    bundle,
    moduleSource,
    ...overrides,
    ...(overrides.checksum !== undefined
      ? { checksum: overrides.checksum }
      : { checksum }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stageExtensionAssetsWithDiagnostics — empty extensions (mocked fs)", () => {
  beforeEach(() => {
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it("produces zero fs side effects for empty extensions list (no mkdir, no write)", () => {
    const result = stageExtensionAssetsWithDiagnostics("/fake/ext-dir", []);

    expect(result).toEqual({ stagedPaths: [], dropped: [] });
    expect(vi.mocked(fs.mkdirSync)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });
});

describe("stageExtensionAssetsWithDiagnostics — write failure (mocked fs)", () => {
  beforeEach(() => {
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it("drops an extension with reason stage_write_failed when writeFileSync throws, does not throw", () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });

    const ext = makeTsModuleExt({ id: "fail-write" });

    const result = stageExtensionAssetsWithDiagnostics("/fake/ext-dir", [ext]);

    expect(result.stagedPaths).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("fail-write");
    expect(result.dropped[0].reason).toBe("stage_write_failed");
  });

  it("stages a sibling extension when a prior write fails (never throws)", () => {
    let callCount = 0;
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("ENOSPC: no space left on device");
      }
      // Second call succeeds (no-op — mock doesn't write real files).
    });

    const failExt = makeTsModuleExt({ id: "will-fail", name: "fail-ext" });
    const goodExt = makeTsModuleExt({
      id: "will-succeed",
      name: "good-ext",
      moduleSource: "export const ok = true;",
    });

    const result = stageExtensionAssetsWithDiagnostics("/fake/ext-dir", [
      failExt,
      goodExt,
    ]);

    // The sibling (second) extension still stages.
    expect(result.stagedPaths).toHaveLength(1);
    expect(result.stagedPaths[0]).toMatch(/will-succeed/);

    // The first is dropped with the correct reason.
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("will-fail");
    expect(result.dropped[0].reason).toBe("stage_write_failed");
  });

  it("calls mkdirSync exactly once before the per-extension loop (not once per extension)", () => {
    // mkdirSync must NOT be called inside the loop — it is hoisted to run once
    // before any extension is processed.
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const extA = makeTsModuleExt({ id: "aa", moduleSource: "const a = 1;" });
    const extB = makeTsModuleExt({ id: "bb", moduleSource: "const b = 2;" });

    stageExtensionAssetsWithDiagnostics("/fake/ext-dir", [extA, extB]);

    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledOnce();
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith("/fake/ext-dir", {
      recursive: true,
    });
  });
});
