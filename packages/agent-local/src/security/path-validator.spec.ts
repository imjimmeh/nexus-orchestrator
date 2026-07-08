import path from "node:path";
import { describe, expect, it } from "vitest";
import { PathValidator } from "./path-validator.js";

describe("PathValidator", () => {
  it("accepts path under allowed root", () => {
    const root = path.resolve(process.cwd());
    const validator = new PathValidator([root]);

    const resolved = validator.resolvePath("src", root);
    expect(resolved.startsWith(root)).toBe(true);
  });

  it("rejects path outside allowed roots", () => {
    const root = path.resolve(process.cwd(), "allowed");
    const validator = new PathValidator([root]);

    expect(() => validator.resolvePath("../outside", root)).toThrow(
      "Path is not within allowed roots",
    );
  });
});
