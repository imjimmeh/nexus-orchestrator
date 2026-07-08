import type { StepCommandModel } from "@/pages/active-session/step-command-model.types";
import { StepCommandCard } from "@/components/sessions/StepCommandCard";

/**
 * Wraps the shared `StepCommandCard` so chat messages that carry a
 * `command_card` metadata payload render the same execution card used in
 * the active-session view.
 */
export function CommandCardMessagePart({
  model,
}: Readonly<{ model: StepCommandModel }>) {
  return <StepCommandCard model={model} />;
}