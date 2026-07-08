import { describe, it, expect } from "vitest";
import { resolvePlane } from "./plane";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

describe("resolvePlane", () => {
  it("returns 'platform' at the global root scope", () => {
    expect(resolvePlane(GLOBAL_SCOPE_NODE_ID)).toBe("platform");
  });

  it("returns 'workspace' for any non-global scope node", () => {
    expect(resolvePlane("11111111-1111-1111-1111-111111111111")).toBe(
      "workspace",
    );
  });
});
