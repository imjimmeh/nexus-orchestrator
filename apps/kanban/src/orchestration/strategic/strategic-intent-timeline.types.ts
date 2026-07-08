export type StrategicIntentPayload = {
  kind: "strategic_intent";
  focus_initiative_id: string | null;
  rationale: string;
  planned_next_steps: string[];
  staleness_actions: string[];
  created_at: string;
};

export type StrategicIntentRequest = {
  focus_initiative_id: string | null;
  rationale: string;
  planned_next_steps: string[];
  staleness_actions: string[];
};
