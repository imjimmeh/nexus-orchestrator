import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentChatPanel } from "./AgentChatPanel";
import type { AgentChatMessage } from "./chat.types";
import { useFileUpload, type UseFileUploadReturn } from "@/hooks/useFileUpload";

vi.mock("@/hooks/useFileUpload", () => ({
  useFileUpload: vi.fn(),
}));

vi.mock("@nexus/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexus/core")>();
  return {
    ...actual,
    ATTACHMENT_MIME_ALLOWLIST: ["image/png", "application/pdf"],
  };
});

const idleFileUpload: UseFileUploadReturn = {
  uploads: [],
  uploading: false,
  addFiles: vi.fn(),
  removeUpload: vi.fn(),
  clear: vi.fn(),
  error: null,
  progress: {},
};

function buildQuestionMessage(
  id: string,
  question: string,
  options: string[],
): AgentChatMessage {
  return {
    id,
    role: "event",
    label: "Questions from Agent",
    category: "question",
    content: question,
    questions: [{ question, options }],
  };
}

function buildMessage(index: number): AgentChatMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "agent" : "user",
    content: `Message ${index}`,
  };
}

function renderChatPanel(messages: AgentChatMessage[], sending = false) {
  return render(
    <AgentChatPanel
      title="Chat"
      messages={messages}
      input=""
      inputPlaceholder="Message"
      onInputChange={vi.fn()}
      onSend={vi.fn()}
      sending={sending}
    />,
  );
}

function getMessageContainer(container: HTMLElement): HTMLElement {
  const messageContainer = container.querySelector(".overflow-y-auto");
  if (!(messageContainer instanceof HTMLElement)) {
    throw new Error("Message container not found");
  }

  return messageContainer;
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(element, "scrollHeight", {
    value: metrics.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(element, "clientHeight", {
    value: metrics.clientHeight,
    configurable: true,
  });
  element.scrollTop = metrics.scrollTop;
}

describe("AgentChatPanel", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    vi.mocked(useFileUpload).mockReturnValue(idleFileUpload);
  });

  it("only enables answers for the active pending question set", async () => {
    const user = userEvent.setup();
    const onAnswerQuestions = vi.fn();
    const activeQuestion = { question: "Current question?", options: ["Vue"] };

    render(
      <AgentChatPanel
        title="Chat"
        messages={[
          buildQuestionMessage("old", "Old question?", ["React"]),
          buildQuestionMessage(
            "current",
            activeQuestion.question,
            activeQuestion.options,
          ),
        ]}
        input=""
        inputPlaceholder="Message"
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        onAnswerQuestions={onAnswerQuestions}
        activeQuestions={[activeQuestion]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "React" }));
    expect(onAnswerQuestions).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Vue" }));
    expect(onAnswerQuestions).toHaveBeenCalledWith([
      { questionIndex: 0, selectedOption: "Vue", freeTextAnswer: null },
    ]);
  });

  it("starts long conversations at the latest 50 messages", () => {
    const messages = Array.from({ length: 75 }, (_, index) =>
      buildMessage(index + 1),
    );

    renderChatPanel(messages);

    expect(screen.queryByText("Message 25")).toBeNull();
    expect(screen.getByText("Message 26")).toBeTruthy();
    expect(screen.getByText("Message 75")).toBeTruthy();
  });

  it("loads older messages when the user scrolls near the top", () => {
    const messages = Array.from({ length: 75 }, (_, index) =>
      buildMessage(index + 1),
    );
    const { container } = renderChatPanel(messages);
    const messageContainer = getMessageContainer(container);
    setScrollMetrics(messageContainer, {
      scrollHeight: 1_000,
      clientHeight: 500,
      scrollTop: 0,
    });

    fireEvent.scroll(messageContainer);

    expect(screen.getByText("Message 25")).toBeTruthy();
    expect(screen.getByText("Message 1")).toBeTruthy();
  });

  it("follows new messages when the user is already at the bottom", () => {
    const initialMessages = Array.from({ length: 50 }, (_, index) =>
      buildMessage(index + 1),
    );
    const { container, rerender } = renderChatPanel(initialMessages);
    const messageContainer = getMessageContainer(container);
    setScrollMetrics(messageContainer, {
      scrollHeight: 1_000,
      clientHeight: 500,
      scrollTop: 500,
    });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    rerender(
      <AgentChatPanel
        title="Chat"
        messages={[...initialMessages, buildMessage(51)]}
        input=""
        inputPlaceholder="Message"
        onInputChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("does not force-scroll new messages while the user is reading history", () => {
    const initialMessages = Array.from({ length: 50 }, (_, index) =>
      buildMessage(index + 1),
    );
    const { container, rerender } = renderChatPanel(initialMessages);
    const messageContainer = getMessageContainer(container);
    setScrollMetrics(messageContainer, {
      scrollHeight: 1_000,
      clientHeight: 500,
      scrollTop: 0,
    });
    fireEvent.scroll(messageContainer);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    rerender(
      <AgentChatPanel
        title="Chat"
        messages={[...initialMessages, buildMessage(51)]}
        input=""
        inputPlaceholder="Message"
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        sending
      />,
    );

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("renders attachment chips for pending uploads", () => {
    vi.mocked(useFileUpload).mockReturnValue({
      ...idleFileUpload,
      uploads: [
        {
          id: "abc-1",
          filename: "doc.pdf",
          mimeType: "application/pdf",
          parseStatus: "parsed",
        },
        {
          id: "abc-2",
          filename: "image.png",
          mimeType: "image/png",
          parseStatus: "pending",
        },
      ],
    });

    renderChatPanel([]);

    expect(screen.getByTitle("doc.pdf")).toBeTruthy();
    expect(screen.getByTitle("image.png")).toBeTruthy();
  });

  it("disables the send button while an upload is in progress", () => {
    vi.mocked(useFileUpload).mockReturnValue({
      ...idleFileUpload,
      uploading: true,
    });

    render(
      <AgentChatPanel
        title="Chat"
        messages={[]}
        input="hello"
        inputPlaceholder="Message"
        onInputChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeDisabled();
  });

  it("passes attachment IDs to onSend and clears uploads after send", async () => {
    const clear = vi.fn();
    const onSend = vi.fn();
    vi.mocked(useFileUpload).mockReturnValue({
      ...idleFileUpload,
      uploads: [
        {
          id: "file-id-1",
          filename: "report.pdf",
          mimeType: "application/pdf",
          parseStatus: "parsed",
        },
      ],
      clear,
    });
    const user = userEvent.setup();

    render(
      <AgentChatPanel
        title="Chat"
        messages={[]}
        input="hello"
        inputPlaceholder="Message"
        onInputChange={vi.fn()}
        onSend={onSend}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith(["file-id-1"]);
    expect(clear).toHaveBeenCalled();
  });
});
