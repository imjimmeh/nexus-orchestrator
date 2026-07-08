import { parseStringRule } from "./tool-policy.parser";
import { ToolPolicyEffect } from "./tool-policy.types";

describe("parseStringRule", () => {
  it("should parse simple allow rules", () => {
    const rule = parseStringRule("allow git status *");
    expect(rule.effect).toBe(ToolPolicyEffect.ALLOW);
    expect(rule.tool).toBe("git");
    expect(rule.arguments).toEqual({ command: "status *" });
  });

  it("should parse require_approval rules", () => {
    const rule = parseStringRule("require_approval bash *");
    expect(rule.effect).toBe(ToolPolicyEffect.REQUIRE_APPROVAL);
    expect(rule.tool).toBe("bash");
    expect(rule.arguments).toEqual({ command: "*" });
  });

  it("should throw on unknown effect", () => {
    expect(() => parseStringRule("invalid tool *")).toThrow(
      "Unknown effect: invalid",
    );
  });

  it("should parse rules with no arguments", () => {
    const rule = parseStringRule("allow ls");
    expect(rule.effect).toBe(ToolPolicyEffect.ALLOW);
    expect(rule.tool).toBe("ls");
    expect(rule.arguments).toBeUndefined();
  });

  it("should handle inconsistent spacing", () => {
    const rule = parseStringRule("  allow   git   status  ");
    expect(rule.effect).toBe(ToolPolicyEffect.ALLOW);
    expect(rule.tool).toBe("git");
    expect(rule.arguments).toEqual({ command: "status" });
  });

  it("should handle glob patterns in tool names", () => {
    const rule = parseStringRule("deny git* *");
    expect(rule.effect).toBe(ToolPolicyEffect.DENY);
    expect(rule.tool).toBe("git*");
    expect(rule.arguments).toEqual({ command: "*" });
  });

  it("should preserve whitespace in arguments", () => {
    const rule = parseStringRule('allow echo "hello   world"');
    expect(rule.effect).toBe(ToolPolicyEffect.ALLOW);
    expect(rule.tool).toBe("echo");
    expect(rule.arguments).toEqual({ command: '"hello   world"' });
  });
});
