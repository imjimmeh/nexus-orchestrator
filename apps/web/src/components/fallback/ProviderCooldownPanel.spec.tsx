import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api/client";
import { ProviderCooldownPanel } from "./ProviderCooldownPanel";

vi.mock("@/lib/api/client", () => ({
  api: { getProviderCooldowns: vi.fn() },
}));

function renderPanel() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <ProviderCooldownPanel />
    </QueryClientProvider>,
  );
}

describe("ProviderCooldownPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state while fetching", () => {
    vi.mocked(api.getProviderCooldowns).mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows empty state when no active cooldowns", async () => {
    vi.mocked(api.getProviderCooldowns).mockResolvedValue([]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/no active cooldowns/i)).toBeInTheDocument(),
    );
  });

  it("displays provider name and reason for each active cooldown", async () => {
    vi.mocked(api.getProviderCooldowns).mockResolvedValue([
      {
        provider_name: "openai",
        reason: "usage_exhausted",
        cooled_until: "2026-06-29T12:00:00Z",
        last_failure_at: "2026-06-29T11:30:00Z",
        source_run_id: null,
      },
    ]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("openai")).toBeInTheDocument());
    expect(screen.getByText(/usage exhausted/i)).toBeInTheDocument();
  });

  it("shows cooled_until date for each active cooldown", async () => {
    vi.mocked(api.getProviderCooldowns).mockResolvedValue([
      {
        provider_name: "anthropic",
        reason: "provider_outage",
        cooled_until: "2026-06-29T14:00:00Z",
        last_failure_at: "2026-06-29T13:58:00Z",
        source_run_id: "run-abc-123",
      },
    ]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText("anthropic")).toBeInTheDocument(),
    );
    expect(screen.getByText(/cooled until/i)).toBeInTheDocument();
    expect(screen.getByText(/provider outage/i)).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(api.getProviderCooldowns).mockRejectedValue(
      new Error("Network error"),
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument(),
    );
  });
});
