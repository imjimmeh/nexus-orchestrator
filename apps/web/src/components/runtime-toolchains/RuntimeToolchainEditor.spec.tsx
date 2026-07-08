import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RuntimeToolchainEditor } from "./RuntimeToolchainEditor";

describe("RuntimeToolchainEditor", () => {
  it("adds a toolchain row via onChange", () => {
    const onChange = vi.fn();
    render(
      <RuntimeToolchainEditor value={{ toolchains: [] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add toolchain/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        toolchains: [{ tool: "node", version: "latest" }],
      }),
    );
  });

  it("removes a toolchain row", () => {
    const onChange = vi.fn();
    render(
      <RuntimeToolchainEditor
        value={{ toolchains: [{ tool: "go", version: "1.23" }] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /remove toolchain 1/i }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ toolchains: [] }),
    );
  });
});
