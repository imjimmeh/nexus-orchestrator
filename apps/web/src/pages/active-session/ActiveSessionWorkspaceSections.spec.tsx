import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ControlButtons } from "./ActiveSessionWorkspaceSections";

function renderControlButtons(
  overrides: Partial<ComponentProps<typeof ControlButtons>> = {},
) {
  const onPause = vi.fn();
  const onResume = vi.fn();
  const onAbort = vi.fn();

  render(
    <ControlButtons
      hasRunId
      supportsPauseResume
      isRunPaused={false}
      isRunTerminal={false}
      pausePending={false}
      resumePending={false}
      abortPending={false}
      onPause={onPause}
      onResume={onResume}
      onAbort={onAbort}
      {...overrides}
    />,
  );
}

describe("ControlButtons", () => {
  it("shows Abort button when not pending", () => {
    renderControlButtons();

    const abortButton = screen.getByRole("button", { name: "Abort" });
    expect(abortButton).toBeTruthy();
    expect(abortButton.hasAttribute("disabled")).toBe(false);
  });

  it("shows Cancelling label and disables abort while pending", () => {
    renderControlButtons({ abortPending: true });

    const abortButton = screen.getByRole("button", { name: "Cancelling..." });
    expect(abortButton).toBeTruthy();
    expect(abortButton.hasAttribute("disabled")).toBe(true);
  });

  it("disables abort when run is already terminal", () => {
    renderControlButtons({ isRunTerminal: true });

    const abortButton = screen.getByRole("button", { name: "Abort" });
    expect(abortButton.hasAttribute("disabled")).toBe(true);
  });
});
