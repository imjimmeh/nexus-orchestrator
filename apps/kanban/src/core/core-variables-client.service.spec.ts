import { describe, expect, it, vi, beforeEach } from "vitest";
import { CoreVariablesClientService } from "./core-variables-client.service";

const getJson = vi.fn();
const postJson = vi.fn();

vi.mock("./kanban-core-http-client", () => ({
  KanbanCoreHttpClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
  ) {
    this["getJson"] = getJson;
    this["postJson"] = postJson;
  }),
}));

describe("CoreVariablesClientService", () => {
  let service: CoreVariablesClientService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CoreVariablesClientService({
      resolveAuthorizationHeader: () => "Bearer test",
    } as never);
  });

  it("fetches effective variables and unwraps data", async () => {
    getJson.mockResolvedValue({
      success: true,
      data: [
        {
          key: "autonomy.dispatch",
          value: "auto",
          type: "string",
          layer: "global",
        },
      ],
    });

    const result = await service.getEffective("proj-1");

    expect(getJson).toHaveBeenCalledWith(
      "/variables/effective?scopeId=proj-1",
      expect.any(String),
    );
    expect(result).toEqual([
      {
        key: "autonomy.dispatch",
        value: "auto",
        type: "string",
        layer: "global",
      },
    ]);
  });

  it("posts an upsert", async () => {
    postJson.mockResolvedValue({ success: true, data: {} });

    await service.upsert({
      scopeNodeId: "proj-1",
      key: "autonomy.dispatch",
      value: "ask",
      valueType: "string",
    });

    expect(postJson).toHaveBeenCalledWith(
      "/variables",
      {
        scopeNodeId: "proj-1",
        key: "autonomy.dispatch",
        value: "ask",
        valueType: "string",
      },
      expect.any(String),
    );
  });
});
