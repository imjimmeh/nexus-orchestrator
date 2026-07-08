import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageItem } from "./ChatMessageItem";
import type { AttachmentDto } from "@nexus/core";

describe("ChatMessageItem", () => {
  it("submits an option answer from an inline question message", async () => {
    const user = userEvent.setup();
    const onAnswerQuestions = vi.fn();

    render(
      <ChatMessageItem
        agentLabel="Agent"
        message={{
          id: "question-1",
          role: "event",
          label: "Questions from Agent",
          category: "question",
          content: "Q1: Which framework? [React / Vue]",
          questions: [
            { question: "Which framework?", options: ["React", "Vue"] },
          ],
        }}
        onAnswerQuestions={onAnswerQuestions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "React" }));

    expect(onAnswerQuestions).toHaveBeenCalledWith([
      { questionIndex: 0, selectedOption: "React", freeTextAnswer: null },
    ]);
  });

  it("submits an other answer from an inline question message", async () => {
    const user = userEvent.setup();
    const onAnswerQuestions = vi.fn();

    render(
      <ChatMessageItem
        agentLabel="Agent"
        message={{
          id: "question-1",
          role: "event",
          label: "Questions from Agent",
          category: "question",
          content: "Q1: Which framework? [React / Vue]",
          questions: [
            { question: "Which framework?", options: ["React", "Vue"] },
          ],
        }}
        onAnswerQuestions={onAnswerQuestions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Other" }));
    await user.type(screen.getByPlaceholderText("Type your answer"), "Svelte");
    await user.click(screen.getByRole("button", { name: "Send answer" }));

    expect(onAnswerQuestions).toHaveBeenCalledWith([
      { questionIndex: 0, selectedOption: null, freeTextAnswer: "Svelte" },
    ]);
  });

  it("uses an option named Other as the custom-answer trigger", async () => {
    const user = userEvent.setup();
    const onAnswerQuestions = vi.fn();

    render(
      <ChatMessageItem
        agentLabel="Agent"
        message={{
          id: "question-1",
          role: "event",
          label: "Questions from Agent",
          category: "question",
          content: "Q1: What type of app? [Web / Mobile / Other]",
          questions: [
            {
              question: "What type of app?",
              options: ["Web", "Mobile", "Other"],
            },
          ],
        }}
        onAnswerQuestions={onAnswerQuestions}
      />,
    );

    const otherButtons = screen.getAllByRole("button", { name: "Other" });
    expect(otherButtons).toHaveLength(1);

    await user.click(otherButtons[0]);

    expect(screen.getByPlaceholderText("Type your answer")).toBeTruthy();
    expect(onAnswerQuestions).not.toHaveBeenCalled();
  });

  it("renders an AttachmentChip for a document attachment", () => {
    const attachment: AttachmentDto = {
      id: "doc-attach-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      parseStatus: "parsed",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    render(
      <ChatMessageItem
        agentLabel="Agent"
        message={{
          id: "msg-1",
          role: "user",
          content: "Here is the document.",
          attachments: [attachment],
        }}
      />,
    );

    expect(screen.getByTitle("report.pdf")).toBeTruthy();
  });

  it("renders an ImageThumbnail for an image attachment", () => {
    const attachment: AttachmentDto = {
      id: "img-attach-1",
      filename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      parseStatus: "parsed",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    render(
      <ChatMessageItem
        agentLabel="Agent"
        message={{
          id: "msg-2",
          role: "user",
          content: "Here is the screenshot.",
          attachments: [attachment],
        }}
      />,
    );

    expect(screen.getByRole("img", { name: "screenshot.png" })).toBeTruthy();
  });

  it("renders ToolCallRenderer when metadata.type is tool_call", () => {
    render(
      <ChatMessageItem
        agentLabel="Agent"
        message={{
          id: "tool-new-1",
          role: "agent",
          category: "tool",
          content: "",
          metadata: {
            type: "tool_call",
            toolName: "unknown_tool",
            callId: "c1",
            status: "finished",
            summary: "unknown_tool · ✓",
            argsObj: {},
            resultObj: "hello\n",
            partialResults: [],
            isError: false,
            startedAt: 1000,
            endedAt: 1100,
            durationMs: 100,
          },
        }}
      />,
    );
    expect(screen.getByText("unknown_tool")).toBeTruthy();
  });

  it("renders ToolCallRenderer via legacy parse when detailsContent exists but no tool_call metadata", () => {
    render(
      <ChatMessageItem
        agentLabel="Agent"
        message={{
          id: "tool-legacy-1",
          role: "agent",
          category: "tool",
          content: "read_file started | args: x",
          detailsContent: 'Args\n{"path":"src/foo.ts"}',
        }}
      />,
    );
    expect(screen.getByText("ok")).toBeTruthy();
  });
});
