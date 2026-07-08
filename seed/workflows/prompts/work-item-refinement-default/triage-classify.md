# Refinement Triage Tie-Breaker

The deterministic triage was ambiguous for this work item. Decide its refinement track.

Read the work item spec (`{{ trigger.resource.metadata.workItemMarkdownPath }}` if present, else `{{ trigger.resource.description }}`).

Choose exactly one `track`:

- `trivial` — a small, well-understood change touching few files; no design questions. Skip codebase analysis, PM clarification, and war-room.
- `standard` — a normal feature/fix needing codebase grounding and an architect plan, but no cross-functional debate.
- `complex` — cross-cutting, risky, or design-contested work needing full PM + war-room alignment.

Call `set_job_output` exactly once: `{ "track": "<trivial|standard|complex>" }`.
