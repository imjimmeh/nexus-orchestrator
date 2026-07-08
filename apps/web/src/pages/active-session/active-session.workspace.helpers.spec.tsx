import { describe, it, expect } from "vitest";
import { isSubagentEvent } from "./active-session.workspace.helpers";

describe("active-session.workspace.helpers", () => {
  describe("isSubagentEvent", () => {
    it("should return false for lifecycle events even if they have subagentExecutionId", () => {
      const event = {
        event_type: "spawn.requested",
        payload: {
          subagentExecutionId: "exec-1",
          domain: "subagent",
        },
      };
      expect(isSubagentEvent(event)).toBe(false);
    });

    it("should return true for internal subagent events", () => {
      const event = {
        event_type: "agent_telemetry",
        payload: {
          subagentExecutionId: "exec-1",
          type: "text",
          text: "hello",
        },
      };
      expect(isSubagentEvent(event)).toBe(true);
    });

    it("should return true for events with chatSessionId and isSubagent: true", () => {
      const event = {
        event_type: "any_event",
        payload: {
          chatSessionId: "session-1",
          isSubagent: true,
        },
      };
      expect(isSubagentEvent(event)).toBe(true);
    });

    it("should return false for normal events", () => {
      const event = {
        event_type: "tool_execution_start",
        payload: {
          toolName: "ls",
        },
      };
      expect(isSubagentEvent(event)).toBe(false);
    });
  });
});
