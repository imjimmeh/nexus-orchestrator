import {
  AGENT_AWAIT_STATUS_VALUES,
  WAIT_REASON_VALUES,
} from "../agent-await.types";

describe("agent-await contracts", () => {
  it("enumerates await statuses", () => {
    expect(AGENT_AWAIT_STATUS_VALUES).toEqual([
      "WAITING",
      "RESUMING",
      "RESUMED",
      "CANCELLED",
    ]);
  });
  it("enumerates wait reasons", () => {
    expect(WAIT_REASON_VALUES).toEqual(["human_input", "dependency"]);
  });
});
