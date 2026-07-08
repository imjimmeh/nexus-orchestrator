import { describe, expect, it } from "vitest";

import {
  buildCanonicalToolNameResolver,
  normalizeToolNameKey,
} from "./tool-name-normalization.js";

describe("normalizeToolNameKey", () => {
  it("lowercases and collapses non-alphanumeric runs to a single underscore", () => {
    expect(normalizeToolNameKey("kanban.project_state")).toBe(
      "kanban_project_state",
    );
    expect(normalizeToolNameKey("Read")).toBe("read");
    expect(normalizeToolNameKey("kanban.work_item")).toBe("kanban_work_item");
  });

  it("is idempotent for already-normalized names", () => {
    expect(normalizeToolNameKey("query_memory")).toBe("query_memory");
  });

  it("trims leading and trailing separators", () => {
    expect(normalizeToolNameKey("__weird.name__")).toBe("weird_name");
  });
});

describe("buildCanonicalToolNameResolver", () => {
  it("recovers a dotted canonical name from its underscore-sanitized form", () => {
    const resolve = buildCanonicalToolNameResolver([
      "kanban.project_state",
      "kanban.orchestration_timeline",
      "query_memory",
    ]);

    // The SDK surfaces `kanban.project_state` as `kanban_project_state`.
    expect(resolve("kanban_project_state")).toBe("kanban.project_state");
    expect(resolve("kanban_orchestration_timeline")).toBe(
      "kanban.orchestration_timeline",
    );
  });

  it("returns an already-canonical name unchanged", () => {
    const resolve = buildCanonicalToolNameResolver(["query_memory"]);
    expect(resolve("query_memory")).toBe("query_memory");
  });

  it("is idempotent when handed the canonical (dotted) name directly", () => {
    const resolve = buildCanonicalToolNameResolver(["kanban.project_state"]);
    expect(resolve("kanban.project_state")).toBe("kanban.project_state");
  });

  it("falls back to the lowercased key for tools absent from the catalog (SDK-native)", () => {
    const resolve = buildCanonicalToolNameResolver(["query_memory"]);
    // `Read`/`Bash` are SDK built-ins, not mounted; governance knows them
    // lowercase (the runner-native convention).
    expect(resolve("Read")).toBe("read");
    expect(resolve("Bash")).toBe("bash");
  });
});
