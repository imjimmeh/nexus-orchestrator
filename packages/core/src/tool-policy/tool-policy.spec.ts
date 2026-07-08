import { ToolPolicyEffect } from "./tool-policy.types";

describe("ToolPolicy Types", () => {
  it("should define expected effects", () => {
    expect(ToolPolicyEffect.ALLOW).toBe("allow");
    expect(ToolPolicyEffect.DENY).toBe("deny");
    expect(ToolPolicyEffect.REQUIRE_APPROVAL).toBe("require_approval");
    expect(ToolPolicyEffect.GUARDRAIL_DENY).toBe("guardrail_deny");
  });
});
