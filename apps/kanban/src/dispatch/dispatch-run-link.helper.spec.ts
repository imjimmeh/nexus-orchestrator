import { describe, it, expect } from "vitest";
import { buildLaunchInputsWithToolchains } from "./dispatch-run-link.helper";

describe("buildLaunchInputsWithToolchains", () => {
  it("adds runtime_toolchains when the project has it", () => {
    const inputs = buildLaunchInputsWithToolchains({
      base: { scopeId: "s" },
      project: {
        runtime_toolchains: { toolchains: [{ tool: "go", version: "1.23" }] },
      },
    });
    expect(inputs.runtime_toolchains).toEqual({
      toolchains: [{ tool: "go", version: "1.23" }],
    });
    expect(inputs.scopeId).toBe("s");
  });

  it("omits runtime_toolchains when null", () => {
    const inputs = buildLaunchInputsWithToolchains({
      base: { scopeId: "s" },
      project: { runtime_toolchains: null },
    });
    expect("runtime_toolchains" in inputs).toBe(false);
  });

  it("omits runtime_toolchains when the project is undefined", () => {
    const inputs = buildLaunchInputsWithToolchains({
      base: { scopeId: "s" },
      project: undefined,
    });
    expect("runtime_toolchains" in inputs).toBe(false);
    expect(inputs.scopeId).toBe("s");
  });
});
