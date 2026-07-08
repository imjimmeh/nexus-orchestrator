import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { HarnessAssetEditor } from "./HarnessAssetEditor";
import type { HarnessContributionsValue } from "./HarnessAssetEditor.types";
import type { HarnessAssetRecord } from "@/lib/api/harness-asset-api.types";

// ---------------------------------------------------------------------------
// Mock the harness asset API so tests never hit the network (Fix A)
// ---------------------------------------------------------------------------

vi.mock("@/lib/api/harness-asset-api", () => ({
  listHarnessAssets: vi.fn().mockResolvedValue([]),
  createHarnessAsset: vi.fn(),
}));

// Convenience re-import after mock so we can control return values per test.
import * as harnessAssetApi from "@/lib/api/harness-asset-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(value: HarnessContributionsValue = null) {
  const onChange = vi.fn<[HarnessContributionsValue], void>();
  render(<HarnessAssetEditor value={value} onChange={onChange} />);
  return { onChange };
}

function lastCall(
  onChange: ReturnType<typeof vi.fn>,
): HarnessContributionsValue {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] ?? undefined;
}

beforeEach(() => {
  vi.mocked(harnessAssetApi.listHarnessAssets).mockResolvedValue([]);
  vi.mocked(harnessAssetApi.createHarnessAsset).mockReset();
});

// ---------------------------------------------------------------------------
// Behavior 1 — script hook produces a valid hook_script payload
// ---------------------------------------------------------------------------

describe("Behavior 1: authoring a hook with language + source produces a valid hook_script payload", () => {
  it("produces a hooks array with a script variant after filling in language and source", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    // Add a hook
    await user.click(screen.getByRole("button", { name: "Add hook" }));

    // The default mode is script / bash — fill in source
    const sourceArea = screen.getByRole("textbox", {
      name: "Hook script source",
    });
    await user.clear(sourceArea);
    await user.type(sourceArea, "echo hello");

    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      expect(val).toBeTruthy();
      const hooks = val["hooks"] as unknown[];
      expect(Array.isArray(hooks)).toBe(true);
      expect(hooks.length).toBe(1);
      const hook = hooks[0] as Record<string, unknown>;
      expect(hook["event"]).toBe("session_start");
      const script = hook["script"] as Record<string, unknown>;
      expect(script["language"]).toBe("bash");
      expect(script["source"]).toBe("echo hello");
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — toggling hook mode preserves shared fields
// ---------------------------------------------------------------------------

describe("Behavior 2: toggling hook between command and script preserves shared fields", () => {
  it("preserves event, matcher, and timeoutMs when switching mode", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    // Add a hook and set its shared fields
    await user.click(screen.getByRole("button", { name: "Add hook" }));

    // Set event to "pre_tool_use"
    const eventTrigger = screen.getByRole("combobox", { name: "Hook event" });
    await user.click(eventTrigger);
    await user.click(screen.getByRole("option", { name: "Pre Tool Use" }));

    // Set matcher - fireEvent.change avoids per-char async turns (consistent with
    // the rest of this file where plain inputs use fireEvent.change, not user.type)
    const matcherInput = screen.getByRole("textbox", { name: "Hook matcher" });
    fireEvent.change(matcherInput, { target: { value: "Bash*" } });

    // Set timeout
    const timeoutInput = screen.getByRole("spinbutton", {
      name: "Hook timeout",
    });
    fireEvent.change(timeoutInput, { target: { value: "3000" } });

    // Fill script source so the hook is valid before switching
    const sourceArea = screen.getByRole("textbox", {
      name: "Hook script source",
    });
    fireEvent.change(sourceArea, { target: { value: "echo 'before'" } });

    // Now switch to command mode
    const typeTrigger = screen.getByRole("combobox", { name: "Hook type" });
    await user.click(typeTrigger);
    await user.click(screen.getByRole("option", { name: "Command" }));

    // Fill the command field
    const commandInput = screen.getByRole("textbox", { name: "Hook command" });
    fireEvent.change(commandInput, {
      target: { value: "/usr/local/bin/hook" },
    });

    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      const hooks = val?.["hooks"] as unknown[];
      expect(Array.isArray(hooks)).toBe(true);
      const hook = hooks?.[0] as Record<string, unknown>;
      // Shared fields survived the mode switch
      expect(hook["event"]).toBe("pre_tool_use");
      expect(hook["matcher"]).toBe("Bash*");
      expect(hook["timeoutMs"]).toBe(3000);
      // New mode-specific field present
      expect(hook["command"]).toBe("/usr/local/bin/hook");
      // Script field absent
      expect(hook["script"]).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — ts-module extension with moduleSource / empty moduleSource error
// ---------------------------------------------------------------------------

describe("Behavior 3: authoring a ts-module extension", () => {
  it("surfaces an inline error when moduleSource is empty for ts-module", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Add extension" }));

    // Fill name and entry so we can trigger the moduleSource validation
    const nameInput = screen.getByRole("textbox", { name: "Extension name" });
    await user.type(nameInput, "my-ext");

    const entryInput = screen.getByRole("textbox", { name: "Extension entry" });
    await user.type(entryInput, "dist/index.js");

    // Type and then clear moduleSource to trigger the inline error
    const moduleSourceArea = screen.getByRole("textbox", {
      name: "Extension module source",
    });
    fireEvent.change(moduleSourceArea, {
      target: { value: "export default {}" },
    });
    await user.clear(moduleSourceArea);

    await waitFor(() => {
      expect(
        screen.getByRole("alert", { name: "Extension module source error" }),
      ).toBeTruthy();
    });
  });

  it("produces a valid extension payload when moduleSource is provided", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(screen.getByRole("button", { name: "Add extension" }));

    const nameInput = screen.getByRole("textbox", { name: "Extension name" });
    await user.type(nameInput, "my-ext");

    const entryInput = screen.getByRole("textbox", { name: "Extension entry" });
    await user.type(entryInput, "dist/index.js");

    const moduleSourceArea = screen.getByRole("textbox", {
      name: "Extension module source",
    });
    fireEvent.change(moduleSourceArea, {
      target: { value: "export default function() {}" },
    });

    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      const extensions = val?.["extensions"] as unknown[];
      expect(Array.isArray(extensions)).toBe(true);
      const ext = extensions?.[0] as Record<string, unknown>;
      expect(ext["name"]).toBe("my-ext");
      expect(ext["runtime"]).toBe("ts-module");
      expect(ext["entry"]).toBe("dist/index.js");
      expect(ext["moduleSource"]).toBe("export default function() {}");
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — attaching existing assets by id round-trips into refs
// ---------------------------------------------------------------------------

describe("Behavior 4: attaching existing asset ids produces pluginRefs / extensionRefs", () => {
  it("adds a pluginRef and round-trips it into the contributions value", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    const pluginInput = screen.getByRole("textbox", {
      name: "Plugin asset id",
    });
    await user.type(pluginInput, "plug-uuid-1");
    await user.click(screen.getByRole("button", { name: "Attach plugin" }));

    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      expect(val?.["pluginRefs"]).toEqual(["plug-uuid-1"]);
    });
  });

  it("adds an extensionRef and round-trips it into the contributions value", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    const extRefInput = screen.getByRole("textbox", {
      name: "Extension asset id",
    });
    await user.type(extRefInput, "ext-uuid-1");
    await user.click(screen.getByRole("button", { name: "Attach extension" }));

    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      expect(val?.["extensionRefs"]).toEqual(["ext-uuid-1"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 — invalid / empty source does not clobber the prior value
// ---------------------------------------------------------------------------

describe("Behavior 5: empty moduleSource surfaces an inline error without clobbering prior value", () => {
  it("keeps the prior extension output when moduleSource is cleared", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    // Author a valid extension first
    await user.click(screen.getByRole("button", { name: "Add extension" }));

    await user.type(
      screen.getByRole("textbox", { name: "Extension name" }),
      "my-ext",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Extension entry" }),
      "dist/index.js",
    );
    const moduleSourceArea = screen.getByRole("textbox", {
      name: "Extension module source",
    });
    fireEvent.change(moduleSourceArea, {
      target: { value: "export default {}" },
    });

    // Capture the last valid onChange value
    let lastValidValue: HarnessContributionsValue;
    await waitFor(() => {
      lastValidValue = lastCall(onChange);
      const extensions = (lastValidValue as Record<string, unknown>)?.[
        "extensions"
      ] as unknown[];
      expect(extensions?.[0]).toBeTruthy();
    });

    // Now clear moduleSource — error should appear
    await user.clear(moduleSourceArea);

    await waitFor(() => {
      expect(
        screen.getByRole("alert", { name: "Extension module source error" }),
      ).toBeTruthy();
    });

    // The output still emits the extension (name + entry still set), but
    // moduleSource will be absent. The key check is that the error is surfaced
    // INLINE (Behavior 5) without a hard page error or silent undefined reset.
    // The prior `name` and `entry` values must survive.
    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      const extensions = val?.["extensions"] as unknown[];
      const ext = extensions?.[0] as Record<string, unknown>;
      expect(ext?.["name"]).toBe("my-ext");
      expect(ext?.["entry"]).toBe("dist/index.js");
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 6 — persist authored extension as reusable asset (Fix A)
// ---------------------------------------------------------------------------

describe("Behavior 6: persisting an authored extension as a reusable asset", () => {
  it("calls POST /harness/assets with the correct payload and adds the returned id to extensionRefs", async () => {
    const user = userEvent.setup();

    const returned: HarnessAssetRecord = {
      id: "asset-uuid-abc",
      kind: "extension",
      name: "my-saved-ext",
      version: "1.0.0",
      source: { kind: "authored" },
      checksum: "sha256:abc",
      bundle: "{}",
      scopeNodeId: null,
      createdAt: "2026-06-23T00:00:00Z",
    };
    vi.mocked(harnessAssetApi.createHarnessAsset).mockResolvedValue(returned);

    const { onChange } = setup();

    // Author a ts-module extension
    await user.click(screen.getByRole("button", { name: "Add extension" }));
    await user.type(
      screen.getByRole("textbox", { name: "Extension name" }),
      "my-ext",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Extension entry" }),
      "dist/index.js",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Extension module source" }),
      { target: { value: "export default function() {}" } },
    );

    // Fill the "save as reusable asset" inline form
    await user.clear(screen.getByRole("textbox", { name: "Asset name" }));
    await user.type(
      screen.getByRole("textbox", { name: "Asset name" }),
      "my-saved-ext",
    );

    await user.click(
      screen.getByRole("button", { name: "Save extension as reusable asset" }),
    );

    // createHarnessAsset must have been called with the extension payload
    await waitFor(() => {
      expect(harnessAssetApi.createHarnessAsset).toHaveBeenCalledWith(
        expect.anything(), // api client
        expect.objectContaining({
          kind: "extension",
          name: "my-saved-ext",
          payload: expect.objectContaining({
            runtime: "ts-module",
            entry: "dist/index.js",
            moduleSource: "export default function() {}",
          }),
        }),
      );
    });

    // The returned id must have been added to extensionRefs
    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      expect(val?.["extensionRefs"]).toContain("asset-uuid-abc");
    });
  });

  it("surfaces a POST error inline without losing the draft", async () => {
    const user = userEvent.setup();

    vi.mocked(harnessAssetApi.createHarnessAsset).mockRejectedValue(
      new Error("Server error: 422 Unprocessable Entity"),
    );

    setup();

    await user.click(screen.getByRole("button", { name: "Add extension" }));
    await user.type(
      screen.getByRole("textbox", { name: "Extension name" }),
      "broken-ext",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Extension entry" }),
      "dist/index.js",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Extension module source" }),
      { target: { value: "export default {}" } },
    );

    await user.clear(screen.getByRole("textbox", { name: "Asset name" }));
    await user.type(
      screen.getByRole("textbox", { name: "Asset name" }),
      "broken-asset",
    );

    await user.click(
      screen.getByRole("button", { name: "Save extension as reusable asset" }),
    );

    // Error appears inline
    await waitFor(() => {
      expect(
        screen.getByRole("alert", { name: "Persist asset error" }),
      ).toBeTruthy();
    });

    // Draft fields still present
    expect(screen.getByRole("textbox", { name: "Extension name" })).toHaveValue(
      "broken-ext",
    );
    expect(
      screen.getByRole("textbox", { name: "Extension entry" }),
    ).toHaveValue("dist/index.js");
  });
});

// ---------------------------------------------------------------------------
// Behavior 7 — attach picker lists GET /harness/assets results (Fix A)
// ---------------------------------------------------------------------------

describe("Behavior 7: attach picker lists GET /harness/assets results", () => {
  it("shows available extension assets in the picker and attaching one adds its id to extensionRefs", async () => {
    const user = userEvent.setup();

    const extensionAsset: HarnessAssetRecord = {
      id: "ext-asset-xyz",
      kind: "extension",
      name: "shared-ext",
      version: "2.0.0",
      source: { kind: "authored" },
      checksum: "sha256:xyz",
      bundle: "{}",
      scopeNodeId: null,
      createdAt: "2026-06-23T00:00:00Z",
    };
    vi.mocked(harnessAssetApi.listHarnessAssets).mockResolvedValue([
      extensionAsset,
    ]);

    const { onChange } = setup();

    // Wait for the picker to load
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Attach asset shared-ext" }),
      ).toBeTruthy();
    });

    // Attach from picker
    await user.click(
      screen.getByRole("button", { name: "Attach asset shared-ext" }),
    );

    // The asset id should appear in extensionRefs
    await waitFor(() => {
      const val = lastCall(onChange) as Record<string, unknown>;
      expect(val?.["extensionRefs"]).toContain("ext-asset-xyz");
    });
  });
});
