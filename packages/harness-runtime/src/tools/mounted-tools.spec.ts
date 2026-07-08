import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureResultFits,
  TOOL_RESULT_CHAR_THRESHOLD,
} from "./mounted-tools.js";

const PREVIEW_PREFIX = "Tool result too large";

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexus-ensure-fits-"));
}

describe("ensureResultFits", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = makeWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("leaves small results untouched", () => {
    const result = {
      content: [{ type: "text", text: "small" }],
      details: { ok: true, action: "x_completed", data: { a: 1 } },
    };

    expect(ensureResultFits(result, workspace, "tool")).toBe(result);
  });

  it("truncates oversized content AND prunes the oversized details payload", () => {
    const hugeData = { items: "x".repeat(TOOL_RESULT_CHAR_THRESHOLD + 5_000) };
    const result = {
      content: [{ type: "text", text: JSON.stringify(hugeData) }],
      details: {
        ok: true,
        action: "kanban_project_state_completed",
        status: 200,
        attempt: 1,
        data: hugeData,
      },
    };

    const fitted = ensureResultFits(
      result,
      workspace,
      "kanban_project_state",
    ) as {
      content: { type: string; text: string }[];
      details: Record<string, unknown>;
    };

    // Content is replaced with a small preview pointing at the file.
    expect(fitted.content[0]?.text).toContain(PREVIEW_PREFIX);
    expect(fitted.content[0]?.text.length).toBeLessThan(
      TOOL_RESULT_CHAR_THRESHOLD,
    );

    // Control fields survive; the bulky data field is dropped.
    expect(fitted.details.ok).toBe(true);
    expect(fitted.details.action).toBe("kanban_project_state_completed");
    expect(fitted.details.status).toBe(200);
    expect(fitted.details.attempt).toBe(1);
    expect(fitted.details.data).toBeUndefined();
    expect(fitted.details.truncated).toBe(true);
    expect(typeof fitted.details.full_output_path).toBe("string");

    // The whole serialized result is now well under the threshold — this is the
    // regression guard: the full payload must not survive in `details`.
    expect(JSON.stringify(fitted).length).toBeLessThan(
      TOOL_RESULT_CHAR_THRESHOLD,
    );
  });

  it("writes the full payload to disk so the agent can retrieve it", () => {
    const hugeText = "y".repeat(TOOL_RESULT_CHAR_THRESHOLD + 5_000);
    const result = {
      content: [{ type: "text", text: hugeText }],
      details: { ok: true, action: "x_completed", data: hugeText },
    };

    const fitted = ensureResultFits(result, workspace, "tool") as {
      details: { full_output_path: string };
    };

    const absolute = path.join(workspace, fitted.details.full_output_path);
    expect(fs.existsSync(absolute)).toBe(true);
    expect(fs.readFileSync(absolute, "utf-8")).toContain(hugeText);
  });

  it("prunes oversized details even when content itself is small", () => {
    const hugeData = { rows: "z".repeat(TOOL_RESULT_CHAR_THRESHOLD + 5_000) };
    const result = {
      content: [{ type: "text", text: "ok" }],
      details: { ok: true, action: "x_completed", data: hugeData },
    };

    const fitted = ensureResultFits(result, workspace, "tool") as {
      details: Record<string, unknown>;
    };

    expect(fitted.details.data).toBeUndefined();
    expect(fitted.details.truncated).toBe(true);
    expect(JSON.stringify(fitted).length).toBeLessThan(
      TOOL_RESULT_CHAR_THRESHOLD,
    );
  });
});
