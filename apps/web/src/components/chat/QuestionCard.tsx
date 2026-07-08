import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageCircleQuestion } from "lucide-react";
import { QuestionAnswer, UserQuestion } from "@/lib/api/settings.types";

interface QuestionCardProps {
  questions: UserQuestion[];
  onSubmit: (answers: QuestionAnswer[]) => void;
  submitting?: boolean;
}

export function QuestionCard({
  questions,
  onSubmit,
  submitting = false,
}: Readonly<QuestionCardProps>) {
  const [answers, setAnswers] = useState<
    Map<number, { selectedOption: string | null; freeTextAnswer: string }>
  >(() => {
    const initial = new Map<
      number,
      { selectedOption: string | null; freeTextAnswer: string }
    >();
    for (let i = 0; i < questions.length; i++) {
      initial.set(i, { selectedOption: null, freeTextAnswer: "" });
    }
    return initial;
  });

  function selectOption(questionIndex: number, option: string) {
    setAnswers((prev) => {
      const next = new Map(prev);
      const current = next.get(questionIndex) || {
        selectedOption: null,
        freeTextAnswer: "",
      };
      next.set(questionIndex, {
        ...current,
        selectedOption: current.selectedOption === option ? null : option,
      });
      return next;
    });
  }

  function setFreeText(questionIndex: number, text: string) {
    setAnswers((prev) => {
      const next = new Map(prev);
      const current = next.get(questionIndex) || {
        selectedOption: null,
        freeTextAnswer: "",
      };
      next.set(questionIndex, { ...current, freeTextAnswer: text });
      return next;
    });
  }

  function handleSubmit() {
    const result: QuestionAnswer[] = questions.map((_, idx) => {
      const answer = answers.get(idx);
      return {
        questionIndex: idx,
        selectedOption: answer?.selectedOption ?? null,
        freeTextAnswer: answer?.freeTextAnswer?.trim() || null,
      };
    });
    onSubmit(result);
  }

  const hasAnyAnswer = Array.from(answers.values()).some(
    (a) => a.selectedOption !== null || a.freeTextAnswer.trim().length > 0,
  );

  return (
    <Card className="border-accent-purple/50 bg-accent-purple/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircleQuestion className="h-5 w-5 text-accent-purple" />
          Agent is asking for your input
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {questions.map((q, idx) => (
          <div key={`q-${q.question}`} className="space-y-2">
            <p className="text-sm font-medium">
              {questions.length > 1 && (
                <span className="text-muted-foreground">Q{idx + 1}. </span>
              )}
              {q.question}
            </p>
            {q.options.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {q.options.map((option) => (
                  <Button
                    key={option}
                    variant={
                      answers.get(idx)?.selectedOption === option
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    onClick={() => selectOption(idx, option)}
                    disabled={submitting}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
            <Textarea
              value={answers.get(idx)?.freeTextAnswer ?? ""}
              onChange={(e) => setFreeText(idx, e.target.value)}
              placeholder="Type a free-text answer (optional)"
              className="min-h-[60px] resize-none"
              disabled={submitting}
            />
          </div>
        ))}
        <Button
          onClick={handleSubmit}
          disabled={submitting || !hasAnyAnswer}
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            "Submit Answers"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
