import { describe, expect, it } from "vitest";
import { CommandAllowlist } from "./command-allowlist.js";

describe("CommandAllowlist", () => {
  it("denies all commands when patterns are empty", () => {
    const allowlist = new CommandAllowlist([]);
    expect(allowlist.isAllowed("npm", ["test"])).toBe(false);
  });

  it("matches wildcard command pattern", () => {
    const allowlist = new CommandAllowlist(["npm run *"]);
    expect(allowlist.isAllowed("npm", ["run", "build"])).toBe(true);
  });

  it("does not match non-allowlisted command", () => {
    const allowlist = new CommandAllowlist(["npm test"]);
    expect(allowlist.isAllowed("git", ["status"])).toBe(false);
  });
});
