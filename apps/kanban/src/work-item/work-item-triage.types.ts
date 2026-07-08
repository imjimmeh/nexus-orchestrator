export type TriageTrack = "trivial" | "standard" | "complex";

export interface TriageSignals {
  description: string | null | undefined;
  acCount: number;
}

export interface TriageScore {
  track: TriageTrack;
  ambiguous: boolean;
  acCount: number;
  descriptionLength: number;
}
