import { describe, expect, it, vi } from "vitest";

import { buildRunnerLocalHandler } from "./kernel.js";
import type { OrchestratorClient } from "./gateway/orchestrator-client.js";

type MockClient = Pick<OrchestratorClient, "emit" | "waitForCommand"> & {
  emit: ReturnType<typeof vi.fn>;
  waitForCommand: ReturnType<typeof vi.fn>;
};

function buildMockClient(): MockClient {
  return {
    emit: vi.fn(),
    waitForCommand: vi.fn(),
  };
}

describe("ask_user_questions wait behavior", () => {
  it("keeps waiting after a wait timeout instead of fabricating an answer", async () => {
    const client = buildMockClient();
    client.waitForCommand
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        type: "question_response",
        answers: [
          { questionIndex: 0, selectedOption: null, freeTextAnswer: "Yes" },
        ],
      });
    const handler = buildRunnerLocalHandler(client);

    const result = await handler("ask_user_questions", {
      questions: [{ question: "Proceed?" }],
    });

    expect(client.waitForCommand).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).toContain("Yes");
    expect(JSON.stringify(result)).not.toContain("Timed out");
  });

  it("posts the questions and returns the user's answer on first response", async () => {
    const client = buildMockClient();
    client.waitForCommand.mockResolvedValueOnce({
      type: "question_response",
      answers: [
        { questionIndex: 0, selectedOption: "Option A", freeTextAnswer: null },
      ],
    });
    const handler = buildRunnerLocalHandler(client);

    const result = await handler("ask_user_questions", {
      questions: [{ question: "Pick one", options: ["Option A", "Option B"] }],
    });

    expect(client.emit).toHaveBeenCalledWith("user_questions_posed", {
      questions: [{ question: "Pick one", options: ["Option A", "Option B"] }],
    });
    const text = JSON.stringify(result);
    expect(text).toContain("Q1: Pick one");
    expect(text).toContain("Option A");
    expect((result as { details: { ok: boolean } }).details.ok).toBe(true);
  });

  it("reports an unsupported runner-local tool", async () => {
    const client = buildMockClient();
    const handler = buildRunnerLocalHandler(client);

    const result = await handler("some_other_tool", {});

    expect(client.waitForCommand).not.toHaveBeenCalled();
    expect((result as { details: { error: string } }).details.error).toBe(
      "unsupported_runner_local_tool",
    );
  });
});
