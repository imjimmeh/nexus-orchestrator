import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api/client";
import { KanbanSettingsCard } from "./KanbanSettingsCard";

vi.mock("@/lib/api/client", () => ({
  api: { getKanbanSettings: vi.fn(), updateKanbanSetting: vi.fn() },
}));

function renderCard() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <KanbanSettingsCard />
    </QueryClientProvider>,
  );
}

describe("KanbanSettingsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getKanbanSettings).mockResolvedValue([
      {
        key: "work_item_dispatch_max_active_per_project",
        value: 3,
        description: "Maximum active work items",
        createdAt: "2026-05-30T00:00:00.000Z",
        updatedAt: "2026-05-30T00:00:00.000Z",
      },
    ]);
    vi.mocked(api.updateKanbanSetting).mockResolvedValue({
      key: "work_item_dispatch_max_active_per_project",
      value: 1,
      description: "Maximum active work items",
      createdAt: "2026-05-30T00:00:00.000Z",
      updatedAt: "2026-05-30T00:00:00.000Z",
    });
  });

  it("renders Kanban-owned settings from the Kanban API", async () => {
    renderCard();

    await waitFor(() => expect(api.getKanbanSettings).toHaveBeenCalled());
    expect(await screen.findByText("Kanban Settings")).toBeTruthy();
    expect(screen.getByText("Max Active Dispatches per Project")).toBeTruthy();
  });

  it("updates settings through the Kanban API", async () => {
    renderCard();

    const input = await screen.findByLabelText(
      "Max Active Dispatches per Project",
    );
    fireEvent.change(input, { target: { value: "1" } });
    const saveButton = input.closest("div")?.querySelector("button");
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    await waitFor(() =>
      expect(api.updateKanbanSetting).toHaveBeenCalledWith(
        "work_item_dispatch_max_active_per_project",
        1,
      ),
    );
  });

  it("refetches and displays the persisted value after saving", async () => {
    vi.mocked(api.getKanbanSettings)
      .mockResolvedValueOnce([
        {
          key: "work_item_dispatch_max_active_per_project",
          value: 3,
          description: "Maximum active work items",
          createdAt: "2026-05-30T00:00:00.000Z",
          updatedAt: "2026-05-30T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          key: "work_item_dispatch_max_active_per_project",
          value: 1,
          description: "Maximum active work items",
          createdAt: "2026-05-30T00:00:00.000Z",
          updatedAt: "2026-05-30T00:00:01.000Z",
        },
      ]);
    renderCard();

    const input = (await screen.findByLabelText(
      "Max Active Dispatches per Project",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1" } });
    const saveButton = input.closest("div")?.querySelector("button");
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    await waitFor(() => expect(api.getKanbanSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(input.value).toBe("1"));
  });

  it("shows save failures without discarding the edited value", async () => {
    vi.mocked(api.updateKanbanSetting).mockRejectedValue(new Error("offline"));
    renderCard();

    const input = (await screen.findByLabelText(
      "Max Active Dispatches per Project",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1" } });
    const saveButton = input.closest("div")?.querySelector("button");
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Failed to save Kanban setting: offline",
    );
    expect(input.value).toBe("1");
  });
});
