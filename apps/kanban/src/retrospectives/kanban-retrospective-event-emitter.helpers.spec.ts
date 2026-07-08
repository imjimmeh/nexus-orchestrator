/**
 * Unit spec for the safeEmitKanbanEvent helper extracted in M2
 * (work item ef4d6799-8468-4c4b-b8d6-20e8f0fca384). The helper
 * delegates to `getKanbanEventEmitter().emit(...)` from the
 * `../events/kanban-event-emitter` module; that module is mocked
 * here so the success / warn / swallow branches can be exercised
 * in isolation from the real `EventEmitter2` singleton.
 */
import type { Logger } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emit = vi.fn();

vi.mock("../events/kanban-event-emitter", () => ({
  getKanbanEventEmitter: () => ({ emit }),
}));

import { safeEmitKanbanEvent } from "./kanban-retrospective-event-emitter.helpers";

describe("safeEmitKanbanEvent", () => {
  let warn: ReturnType<typeof vi.fn>;
  let logger: Logger;

  beforeEach(() => {
    emit.mockReset();
    warn = vi.fn();
    logger = { warn } as unknown as Logger;
  });

  it("emits the event through the kanban emitter when the emitter succeeds", () => {
    emit.mockReturnValue(true);

    safeEmitKanbanEvent("kanban.test.event", { foo: "bar" }, logger);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("kanban.test.event", { foo: "bar" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a warning and swallows the error when the emitter throws", () => {
    emit.mockImplementation(() => {
      throw new Error("emitter offline");
    });

    safeEmitKanbanEvent("kanban.test.event", { foo: "bar" }, logger);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("kanban.test.event", { foo: "bar" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Failed to emit kanban.test.event: emitter offline",
    );
  });

  it("never rethrows when the emitter throws", () => {
    emit.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => {
      safeEmitKanbanEvent("kanban.test.event", { foo: "bar" }, logger);
    }).not.toThrow();
  });
});