import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RuntimeToolchainsCard } from "./RuntimeToolchainsCard";

describe("RuntimeToolchainsCard", () => {
  it("saves the edited toolchains via onSave", () => {
    const onSave = vi.fn();
    render(
      <RuntimeToolchainsCard value={{ toolchains: [] }} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add toolchain/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /save runtime toolchains/i }),
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        toolchains: [{ tool: "node", version: "latest" }],
      }),
    );
  });
});
