import { describe, expect, it } from "vitest";
import {
  OpenWarRoomSchema,
  UpdateWarRoomBlackboardSchema,
} from "./war-room.schemas.js";
import { toJSONSchema } from "zod";
describe("OpenWarRoomSchema", () => {
  it("accepts native participants arrays", () => {
    const input = {
      action: "open_war_room",
      session_id: "plan-alignment-7e953192",
      participants: [
        { agent_profile: "senior_dev", role: "dev" },
        { agent_profile: "qa_automation", role: "qa" },
      ],
    };

    expect(OpenWarRoomSchema.parse(input)).toEqual(input);
  });

  it("rejects JSON-stringified participants", () => {
    expect(() =>
      OpenWarRoomSchema.parse({
        action: "open_war_room",
        session_id: "plan-alignment-7e953192",
        participants:
          '[{"agent_profile":"senior_dev","role":"dev"},{"agent_profile":"qa_automation","role":"qa"}]',
      }),
    ).toThrow();
  });

  it("rejects moderator_profile override", () => {
    expect(() =>
      OpenWarRoomSchema.parse({
        action: "open_war_room",
        session_id: "plan-alignment-7e953192",
        moderator_profile: "ceo-agent",
      }),
    ).toThrow();
  });

  it("rejects unsupported identifier fields", () => {
    expect(() =>
      OpenWarRoomSchema.parse({
        action: "open_war_room",
        session_id: "plan-alignment-7e953192",
        unsupported_scope_id: "scope-1",
      }),
    ).toThrow();

    expect(() =>
      OpenWarRoomSchema.parse({
        action: "open_war_room",
        session_id: "plan-alignment-7e953192",
        unsupported_context_id: "resource-1",
      }),
    ).toThrow();
  });

  it("renders properly as a JSON schema", () => {
    const schemaJson = toJSONSchema(OpenWarRoomSchema);
    expect(schemaJson).toBeDefined();
    expect(schemaJson.properties).toBeDefined();
    expect(schemaJson.properties?.participants).toBeDefined();
  });
});

describe("UpdateWarRoomBlackboardSchema", () => {
  it("accepts native list fields", () => {
    const input = {
      action: "update_war_room_blackboard",
      session_id: "plan-alignment-7e953192",
      strategy_summary: "Review plan",
      risks: [],
      decision_log: [{ decision: "approve plan" }],
    };

    expect(UpdateWarRoomBlackboardSchema.parse(input)).toEqual(input);
  });

  it("rejects JSON-stringified list fields", () => {
    expect(() =>
      UpdateWarRoomBlackboardSchema.parse({
        action: "update_war_room_blackboard",
        session_id: "plan-alignment-7e953192",
        strategy_summary: "Review plan",
        risks: "[]",
        decision_log: '[{"decision":"approve plan"}]',
      }),
    ).toThrow();
  });
});
