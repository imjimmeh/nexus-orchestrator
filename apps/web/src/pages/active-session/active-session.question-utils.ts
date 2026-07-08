import { UserQuestion } from "@/lib/api/settings.types";
import { asString } from "./active-session.chat-helpers";

export function toUserQuestions(value: unknown): UserQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const questions: UserQuestion[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    const question = asString(raw.question);
    if (!question) {
      continue;
    }

    const options = Array.isArray(raw.options)
      ? raw.options.filter(
          (option): option is string => typeof option === "string",
        )
      : [];

    questions.push({ question, options });
  }

  return questions.length > 0 ? questions : null;
}

export function getQuestionsFromToolArgs(
  payload: Record<string, unknown>,
): UserQuestion[] | null {
  const args = payload.args;
  if (!args || typeof args !== "object") {
    return null;
  }

  const rawQuestions = (args as Record<string, unknown>).questions;
  return toUserQuestions(rawQuestions);
}
