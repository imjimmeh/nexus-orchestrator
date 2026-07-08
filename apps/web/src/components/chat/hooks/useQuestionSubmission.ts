import { useCallback, useEffect, useRef, useState } from "react";
import type {
  QuestionSubmissionHandlers,
  UseQuestionSubmissionParams,
} from "./useQuestionSubmission.types";

/**
 * Encapsulates the per-question submission lifecycle: option selection,
 * free-text "Other" input, and the side effect that resets the "submitted"
 * flag once `answeringQuestions` flips from true to false (so a follow-up
 * round of questions becomes answerable again).
 */
export function useQuestionSubmission({
  answeringQuestions,
  onAnswerQuestions,
}: UseQuestionSubmissionParams): QuestionSubmissionHandlers {
  const [otherIndex, setOtherIndex] = useState<number | null>(null);
  const [otherAnswer, setOtherAnswer] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<Map<number, string>>(
    new Map(),
  );
  const [submitted, setSubmitted] = useState(false);
  const prevAnsweringRef = useRef<boolean>(false);

  useEffect(() => {
    const wasAnswering = prevAnsweringRef.current;
    const isAnswering = answeringQuestions ?? false;
    if (wasAnswering && !isAnswering) {
      setSubmitted(false);
    }
    prevAnsweringRef.current = isAnswering;
  }, [answeringQuestions]);

  const showOtherInput = useCallback((questionIndex: number) => {
    setOtherIndex(questionIndex);
    setOtherAnswer("");
  }, []);

  const submitOption = useCallback(
    (questionIndex: number, selectedOption: string) => {
      setSelectedOptions(new Map([[questionIndex, selectedOption]]));
      setSubmitted(true);
      onAnswerQuestions?.([
        { questionIndex, selectedOption, freeTextAnswer: null },
      ]);
    },
    [onAnswerQuestions],
  );

  const submitOther = useCallback(
    (questionIndex: number) => {
      const trimmed = otherAnswer.trim();
      if (!trimmed) {
        return;
      }
      setSubmitted(true);
      onAnswerQuestions?.([
        { questionIndex, selectedOption: null, freeTextAnswer: trimmed },
      ]);
    },
    [onAnswerQuestions, otherAnswer],
  );

  return {
    disabled: answeringQuestions === true || !onAnswerQuestions || submitted,
    isOptionSelected: (questionIndex, option) =>
      selectedOptions.get(questionIndex) === option,
    isOtherActive: (questionIndex) => otherIndex === questionIndex,
    otherAnswer,
    setOtherAnswer,
    showOtherInput,
    submitOption,
    submitOther,
  };
}