import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { HarnessAssetImport } from "./HarnessAssetImport";
import type { HarnessAssetKind } from "@/lib/api/harness-asset-api.types";
import type { ImportPreviewResult } from "./HarnessAssetImport.types";

// ---------------------------------------------------------------------------
// Mock the harness asset import API helpers so tests never hit the network
// ---------------------------------------------------------------------------

vi.mock("@/lib/api/harness-asset-api", () => ({
  listHarnessAssets: vi.fn().mockResolvedValue([]),
  createHarnessAsset: vi.fn(),
  previewImportAsset: vi.fn(),
  confirmImportAsset: vi.fn(),
}));

import * as harnessAssetApi from "@/lib/api/harness-asset-api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLUGIN_PREVIEW: ImportPreviewResult = {
  kind: "plugin",
  manifest: { name: "my-cc-plugin", capabilities: { read: true } },
  checksum: "sha256:aabbccdd",
  pinnedSource: {
    kind: "git",
    repo: "https://github.com/acme/plugin",
    ref: "abc1234",
  },
};

const EXTENSION_PREVIEW: ImportPreviewResult = {
  kind: "extension",
  manifest: { entry: "dist/index.js" },
  checksum: "sha256:eeff0011",
  pinnedSource: {
    kind: "git",
    repo: "https://github.com/acme/ext",
    ref: "def5678",
  },
};

const VALID_GIT_SOURCE_JSON = JSON.stringify({
  kind: "git",
  repo: "https://github.com/acme/plugin",
  ref: "main",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(
  onImported = vi.fn<
    [string, Extract<HarnessAssetKind, "plugin" | "extension">],
    void
  >(),
) {
  const user = userEvent.setup();
  render(<HarnessAssetImport onImported={onImported} />);
  return { user, onImported };
}

beforeEach(() => {
  vi.mocked(harnessAssetApi.previewImportAsset).mockReset();
  vi.mocked(harnessAssetApi.confirmImportAsset).mockReset();
});

// ---------------------------------------------------------------------------
// Behavior 1 — preview renders manifest + pinned ref + checksum + kind
// ---------------------------------------------------------------------------

describe("Behavior 1: preview renders manifest summary, pinned ref, kind, and checksum", () => {
  it("calls previewImportAsset and renders the returned data", async () => {
    vi.mocked(harnessAssetApi.previewImportAsset).mockResolvedValue(
      PLUGIN_PREVIEW,
    );
    const { user } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: VALID_GIT_SOURCE_JSON } });

    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(harnessAssetApi.previewImportAsset).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: "git",
          repo: "https://github.com/acme/plugin",
        }),
        undefined,
      );
    });

    // kind
    expect(screen.getByText("plugin")).toBeTruthy();
    // checksum
    expect(screen.getByText("sha256:aabbccdd")).toBeTruthy();
    // pinned ref / sha
    expect(screen.getByText("abc1234")).toBeTruthy();
    // manifest name field is rendered
    expect(screen.getByText("my-cc-plugin")).toBeTruthy();

    // Confirm button should be visible after successful preview
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeTruthy();
  });

  it("renders extension manifest for extension kind", async () => {
    vi.mocked(harnessAssetApi.previewImportAsset).mockResolvedValue(
      EXTENSION_PREVIEW,
    );
    const { user } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: VALID_GIT_SOURCE_JSON } });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(screen.getByText("extension")).toBeTruthy();
    });

    expect(screen.getByText("sha256:eeff0011")).toBeTruthy();
    expect(screen.getByText("def5678")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — confirm attaches returned id to the correct ref list by kind
// ---------------------------------------------------------------------------

describe("Behavior 2: confirm calls confirmImportAsset and fires onImported with id + kind", () => {
  it("attaches to pluginRefs when kind is plugin", async () => {
    vi.mocked(harnessAssetApi.previewImportAsset).mockResolvedValue(
      PLUGIN_PREVIEW,
    );
    vi.mocked(harnessAssetApi.confirmImportAsset).mockResolvedValue({
      id: "asset-plugin-001",
    });

    const { user, onImported } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: VALID_GIT_SOURCE_JSON } });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith("asset-plugin-001", "plugin");
    });
  });

  it("attaches to extensionRefs when kind is extension", async () => {
    vi.mocked(harnessAssetApi.previewImportAsset).mockResolvedValue(
      EXTENSION_PREVIEW,
    );
    vi.mocked(harnessAssetApi.confirmImportAsset).mockResolvedValue({
      id: "asset-ext-002",
    });

    const { user, onImported } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: VALID_GIT_SOURCE_JSON } });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith("asset-ext-002", "extension");
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — API errors surface inline without losing the source input
// ---------------------------------------------------------------------------

describe("Behavior 3: API errors surface inline without clearing the source input", () => {
  it("shows an inline error message when preview fails", async () => {
    vi.mocked(harnessAssetApi.previewImportAsset).mockRejectedValue(
      new Error("422 Unprocessable Entity"),
    );

    const { user } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: VALID_GIT_SOURCE_JSON } });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "Import error" })).toBeTruthy();
    });

    // Source input must not be cleared
    expect(input).toHaveValue(VALID_GIT_SOURCE_JSON);

    // Confirm button must NOT be visible
    expect(screen.queryByRole("button", { name: "Confirm import" })).toBeNull();
  });

  it("shows an inline error when confirm fails", async () => {
    vi.mocked(harnessAssetApi.previewImportAsset).mockResolvedValue(
      PLUGIN_PREVIEW,
    );
    vi.mocked(harnessAssetApi.confirmImportAsset).mockRejectedValue(
      new Error("500 Internal Server Error"),
    );

    const { user } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: VALID_GIT_SOURCE_JSON } });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "Import error" })).toBeTruthy();
    });

    // Source input must still be present
    expect(input).toHaveValue(VALID_GIT_SOURCE_JSON);
  });

  it("shows an inline error when source JSON is malformed", async () => {
    const { user } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: "not-valid-json{{{" } });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "Import error" })).toBeTruthy();
    });

    // API must NOT have been called
    expect(harnessAssetApi.previewImportAsset).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — secret values are never rendered
// ---------------------------------------------------------------------------

describe("Behavior 4: the preview never exposes secret values", () => {
  it("does not render any field named 'secret', 'token', or 'password'", async () => {
    const previewWithSafeSummary: ImportPreviewResult = {
      ...PLUGIN_PREVIEW,
      manifest: {
        name: "safe-plugin",
        // These fields are intentionally absent — the API never returns them.
        // This test just confirms the component doesn't fabricate them.
      },
    };

    vi.mocked(harnessAssetApi.previewImportAsset).mockResolvedValue(
      previewWithSafeSummary,
    );

    const { user } = setup();

    const input = screen.getByRole("textbox", { name: "Import source" });
    fireEvent.change(input, { target: { value: VALID_GIT_SOURCE_JSON } });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(screen.getByText("plugin")).toBeTruthy();
    });

    const container = document.body;
    expect(container.innerHTML).not.toMatch(/\bsecret\b/i);
    expect(container.innerHTML).not.toMatch(/\bpassword\b/i);
    expect(container.innerHTML).not.toMatch(/\btoken\b/i);
  });
});
