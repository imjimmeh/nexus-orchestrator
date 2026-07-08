import {
  TriageScore,
  TriageSignals,
  TriageTrack,
} from "./work-item-triage.types";

const TRIVIAL_MAX_AC = 2;
const TRIVIAL_MAX_DESC = 600;
const COMPLEX_MIN_AC = 8;
const COMPLEX_MIN_DESC = 2500;
// Ambiguity margin: signals within this band of a threshold, or signals that
// disagree on the track, force the LLM tie-breaker.
const AMBIGUITY_DESC_MARGIN = 300;

export function scoreTriage(signals: TriageSignals): TriageScore {
  const descriptionLength = signals.description?.length ?? 0;
  const acCount = signals.acCount;

  const acTrack: TriageTrack =
    acCount <= TRIVIAL_MAX_AC
      ? "trivial"
      : acCount >= COMPLEX_MIN_AC
        ? "complex"
        : "standard";
  const descTrack: TriageTrack =
    descriptionLength < TRIVIAL_MAX_DESC
      ? "trivial"
      : descriptionLength > COMPLEX_MIN_DESC
        ? "complex"
        : "standard";

  // Final track = the more demanding of the two signals.
  const order: TriageTrack[] = ["trivial", "standard", "complex"];
  const track =
    order.indexOf(acTrack) >= order.indexOf(descTrack) ? acTrack : descTrack;

  const signalsDisagree = acTrack !== descTrack;
  const nearDescBoundary =
    Math.abs(descriptionLength - TRIVIAL_MAX_DESC) <= AMBIGUITY_DESC_MARGIN ||
    Math.abs(descriptionLength - COMPLEX_MIN_DESC) <= AMBIGUITY_DESC_MARGIN;
  const ambiguous = signalsDisagree || nearDescBoundary;

  return { track, ambiguous, acCount, descriptionLength };
}
