import { describe, expect, it } from "vitest";
import { parseLegacyKanbanImportCliArgs } from "./legacy-kanban-import.cli";

describe("legacy kanban import CLI", () => {
  it("defaults to dry-run mode with environment-backed database URLs", () => {
    expect(parseLegacyKanbanImportCliArgs([])).toEqual({
      mode: "dry-run",
      apiDatabaseUrl: undefined,
      kanbanDatabaseUrl: undefined,
    });
  });

  it("parses import and reconcile modes with explicit database URLs", () => {
    expect(
      parseLegacyKanbanImportCliArgs([
        "--mode",
        "import",
        "--api-database-url",
        "postgres://api",
        "--kanban-database-url",
        "postgres://kanban",
      ]),
    ).toEqual({
      mode: "import",
      apiDatabaseUrl: "postgres://api",
      kanbanDatabaseUrl: "postgres://kanban",
    });

    expect(parseLegacyKanbanImportCliArgs(["--mode=reconcile"])).toEqual({
      mode: "reconcile",
      apiDatabaseUrl: undefined,
      kanbanDatabaseUrl: undefined,
    });
  });

  it("rejects unknown modes and flags", () => {
    expect(() => parseLegacyKanbanImportCliArgs(["--mode", "delete"])).toThrow(
      "Invalid --mode",
    );
    expect(() => parseLegacyKanbanImportCliArgs(["--unknown"])).toThrow(
      "Unknown argument",
    );
  });
});
