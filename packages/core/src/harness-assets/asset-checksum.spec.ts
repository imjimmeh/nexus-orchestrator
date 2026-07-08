import { describe, expect, it } from "vitest";
import { computeAssetChecksum } from "./asset-checksum";

describe("computeAssetChecksum", () => {
  it("returns a sha256-prefixed hex digest of the bundle", () => {
    // SHA-256 of the empty string is a well-known constant.
    expect(computeAssetChecksum("")).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("emits the sha256: prefix followed by a 64-char lowercase hex digest", () => {
    expect(computeAssetChecksum("nexus")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("produces stable, deterministic output for identical input", () => {
    expect(computeAssetChecksum("same-bundle")).toBe(
      computeAssetChecksum("same-bundle"),
    );
  });

  it("produces different checksums for different input", () => {
    expect(computeAssetChecksum("a")).not.toBe(computeAssetChecksum("b"));
  });
});
