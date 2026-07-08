import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EffectiveConfigInspector } from "./EffectiveConfigInspector";
import * as hooks from "@/hooks/useScopedVariables";

describe("EffectiveConfigInspector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the resolving layer for each effective variable", () => {
    vi.spyOn(hooks, "useEffectiveVariables").mockReturnValue({
      data: [
        {
          key: "autonomy.dispatch",
          value: "ask",
          type: "string",
          layer: "p-1",
        },
        {
          key: "autonomy.merge",
          value: "ask",
          type: "string",
          layer: "global",
        },
      ],
      isLoading: false,
    } as never);

    render(<EffectiveConfigInspector scopeId="p-1" />);

    expect(screen.getByText("autonomy.dispatch")).toBeTruthy();
    expect(screen.getByText("project")).toBeTruthy();
    expect(screen.getByText("global")).toBeTruthy();
  });

  it("shows loading state when data is not yet available", () => {
    vi.spyOn(hooks, "useEffectiveVariables").mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    render(<EffectiveConfigInspector scopeId="p-1" />);

    expect(screen.getByText(/loading effective config/i)).toBeTruthy();
  });

  it("shows empty state when no variables are configured", () => {
    vi.spyOn(hooks, "useEffectiveVariables").mockReturnValue({
      data: [],
      isLoading: false,
    } as never);

    render(<EffectiveConfigInspector scopeId="p-1" />);

    expect(screen.getByText(/no effective variables/i)).toBeTruthy();
  });
});
