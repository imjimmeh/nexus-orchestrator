import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Setup } from "./Setup";

const navigateMock = vi.hoisted(() => vi.fn());
const initializeSetupMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/api/client", () => ({
  api: {
    initializeSetup: initializeSetupMock,
  },
}));

describe("Setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits setup data and navigates to dashboard on success", async () => {
    initializeSetupMock.mockResolvedValue({ initialized: true });

    render(
      <MemoryRouter>
        <Setup />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("API key / secret value"), {
      target: { value: "seed-secret" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /initialize platform setup/i }),
    );

    await waitFor(() => {
      expect(initializeSetupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerName: "chutes.ai",
          modelName: "MiniMaxAI/MiniMax-M2.5-TEE",
          secretValue: "seed-secret",
        }),
      );
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
  });
});
