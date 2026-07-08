import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AgentChatMessage,
  type AnswerQuestionsHandler,
} from "../chat.types";
import { useQuestionSubmission } from "../hooks/useQuestionSubmission";

export interface QuestionMessagePartProps {
  message: AgentChatMessage;
  answeringQuestions?: boolean;
  onAnswerQuestions?: AnswerQuestionsHandler;
}

/**
 * Inline question UI used inside chat messages. Unlike the standalone
 * `QuestionCard` (textarea + Submit Answers button), this UI is wired so
 * that clicking an option immediately submits a single-question answer,
 * and the free-text "Other" branch has its own Send button. This matches
 * the chat-message-item test contract.
 */
export function QuestionMessagePart({
  message,
  answeringQuestions,
  onAnswerQuestions,
}: Readonly<QuestionMessagePartProps>) {
  const questions = message.questions ?? [];
  const {
    disabled,
    isOptionSelected,
    isOtherActive,
    otherAnswer,
    setOtherAnswer,
    showOtherInput,
    submitOption,
    submitOther,
  } = useQuestionSubmission({
    answeringQuestions,
    onAnswerQuestions,
  });

  return (
    <div className="space-y-3">
      {questions.map((question, index) => (
        <div key={`${question.question}-${index}`} className="space-y-2">
          <p className="font-medium text-foreground">
            {questions.length > 1 && (
              <span className="text-muted-foreground">Q{index + 1}. </span>
            )}
            {question.question}
          </p>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const isOtherOption = option.trim().toLowerCase() === "other";
              const selected = isOptionSelected(index, option);
              return (
                <Button
                  key={option}
                  type="button"
                  variant={
                    selected
                      ? "default"
                      : isOtherOption && isOtherActive(index)
                        ? "secondary"
                        : "outline"
                  }
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    isOtherOption
                      ? showOtherInput(index)
                      : submitOption(index, option)
                  }
                >
                  {option}
                </Button>
              );
            })}
            {!question.options.some(
              (option) => option.trim().toLowerCase() === "other",
            ) && (
              <Button
                type="button"
                variant={isOtherActive(index) ? "secondary" : "outline"}
                size="sm"
                disabled={disabled}
                onClick={() => showOtherInput(index)}
              >
                Other
              </Button>
            )}
          </div>
          {isOtherActive(index) && (
            <div className="flex gap-2">
              <Input
                value={otherAnswer}
                onChange={(event) => setOtherAnswer(event.target.value)}
                placeholder="Type your answer"
                disabled={disabled}
              />
              <Button
                type="button"
                size="sm"
                disabled={disabled || otherAnswer.trim().length === 0}
                onClick={() => submitOther(index)}
              >
                Send answer
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}