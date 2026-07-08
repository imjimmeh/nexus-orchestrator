# WarRoomSessionManagerPanel — File Organization

> Contributor reference for the `WarRoomSessionManagerPanel` component
> folder under `apps/web/src/components/orchestration/`. This is the
> canonical map of which files own which concerns after the
> EPIC-207 / child-3 decomposition. **Read this before editing any
> file in that folder:** the split between presentation-only section
> components, the state hook, the mutation/query hooks, and the
> top-level shell is intentional and tested.

## Purpose

`WarRoomSessionManagerPanel` lets operators open, list, select,
inspect, invite into, post messages to, and close War Room sessions
for a given project and workflow run. It is rendered by
`apps/web/src/pages/project-workspace/OrchestrationDetailsSection.tsx`
and re-exported through
`apps/web/src/components/orchestration/index.ts`.

## Why this layout — what shipped in this branch

The original implementation lived almost entirely inside a single
`WarRoomSessionManagerPanel` component plus a thin `.sections.tsx`
re-export shim. As the file grew it conflated four orthogonal
concerns: (a) **local form state** for every form control on the
panel, (b) **types** shared between the panel and its supporting
hooks, (c) **session queries** (TanStack React Query), and (d) the
**session actions** (mutations). This branch — **child-3 of
EPIC-207 / WarRoomSelectedSessionSection split** — shipped
**exactly one of those concerns**: the
`war-room-selected-session-section.tsx` file (originally ≈ 338
LOC) was split into a thin composer
(`war-room-selected-session-section.tsx`, **now 52 LOC**, down
from 338) plus four focused sub-section files —
`war-room-state-summary-section.tsx`,
`war-room-invite-section.tsx`, `war-room-message-section.tsx`, and
`war-room-close-section.tsx` — each owning a single concern:
state summary, invite, post-message, and close, respectively. The
top-level shell (`WarRoomSessionManagerPanel.tsx`), the panel-level
model hook (`WarRoomSessionManagerPanel.hooks.tsx`), the
consolidated local-form-state hook
(`war-room-manager-state.hooks.ts` + its spec), the cross-file
types file (`WarRoomSessionManagerPanel.types.ts`), the 3-line
re-export shim (`WarRoomSessionManagerPanel.sections.tsx`), the
query hooks (`war-room-sessions-query.hooks.ts`), the mutations
hook (`war-room-mutations.hooks.ts`), and the other consumer-facing
sections (`war-room-open-session-section.tsx`,
`war-room-session-selector-section.tsx`) all **remain in place
unchanged** — they were not in scope for this branch.

> **Why this layout, specifically:** the section split is
> self-contained, contract-preserving, and reviewable in
> isolation: the `WarRoomSelectedSessionSection` component name and
> the `WarRoomSelectedSessionSectionProps` interface are byte-for-byte
> the same after the split (the same 19 props, same defaults), so no
> caller (`WarRoomSessionManagerPanel.tsx`, the spec, anything else)
> changes. The four extracted sub-sections are reachable only
> through the composer's prop wiring — they are intentionally
> **not** re-exported from `WarRoomSessionManagerPanel.sections.tsx`,
> preserving the public surface area for the rest of the app. See
> the audit at
> [`docs/analysis/warroom-manager-panel-audit.md`](../analysis/warroom-manager-panel-audit.md)
> for the full ownership map (this audit doc is owned by the
> EPIC-207 audit pass; if the path is missing on this branch it
> means the audit has not landed here yet — the rationale above is
> sufficient on its own).

## Dependency ordering — what is *not* on this branch

The selected-session split was designed to be the **first** of three
sibling decompositions; the other two were intentionally deferred so
the section split could land without coupling to a state-rewrite:

| Sibling work item | What it owns                                                                              | Branch artefact (when shipped)                                                                                            | Dependency                                                        |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **child-1**       | `useWarRoomManagerState` → single `useReducer` migration with compound reset actions (`resetOpenSessionForm`, `resetMessageForm`, `resetCloseForm`, `setInvite` that clears the agent profile). | `war-room-manager-state.hooks.ts` shrinks from 10 `useState` calls to one reducer call. The `WarRoomManagerState` shape stays the same; the `setX` setters are re-implemented as `dispatch` wrappers. | **None on child-3** — once child-1 lands, this branch's spec must be re-scoped to test reducer transitions instead of per-field setters. |
| **child-2**       | Collapse `WarRoomSessionManagerPanel.types.ts` (≈ 110 LOC) into `WarRoomSessionManagerPanel.hooks.tsx`, and delete the 3-line `WarRoomSessionManagerPanel.sections.tsx` re-export shim. | `WarRoomSessionManagerPanel.types.ts` disappears; types migrate into the hooks file. `WarRoomSessionManagerPanel.sections.tsx` is removed; `WarRoomSessionManagerPanel.tsx` imports the three section components directly. | **Depends on child-3 having landed** so `WarRoomSessionManagerPanel.tsx` is only touched once (after the inner sub-sections are already extracted). |

**Migration path for contributors:** if you arrive at this code
and the child-1 / child-2 work has *not* landed, treat the
`useState` + retained-types + retained-shim world as the current
reality. The `war-room-manager-state.hooks.spec.ts` already pins
the per-field `useState` semantics and explicitly asserts the
absence of compound reset actions, so an accidental unilateral
introduction of reducers or compound resets will fail tests. When
child-1 lands, update the state hook, delete the
"useState-per-field" guard test, and add reducer-transition tests
in the same spec file. When child-2 lands, drop the
`WarRoomSessionManagerPanel.types.ts` column from the file-org
tables below and rewire `WarRoomSessionManagerPanel.tsx` to
import the three section components directly.

## File Organization

All paths below are relative to
`apps/web/src/components/orchestration/`.

### Top-level `WarRoomSessionManagerPanel.*` files

| File                                       | Responsibility                                                                                                                                                                          | Approx. lines |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `WarRoomSessionManagerPanel.tsx`           | Top-level component: renders `Card` chrome, short-circuits when `workflowRunId` is missing, delegates to `useWarRoomSessionManagerModel`, and lays out the three consumer-facing sections. | 110           |
| `WarRoomSessionManagerPanel.hooks.tsx`     | `useWarRoomSessionManagerModel` — the panel-level model hook. Composes the state hook, the session query hooks, the mutations hook, and a derived `WarRoomSessionManagerModel` bundle. | 178           |
| `WarRoomSessionManagerPanel.types.ts`      | Cross-file types: `WarRoomManagerState`, `WarRoomActionNotice`, `WarRoomStateSummary`, `WarRoomSessionManagerModel`, `WarRoomSessionManagerContentProps`, `UseWarRoomMutationsParams`, `WarRoomMutationsResult`. | 110 |
| `WarRoomSessionManagerPanel.sections.tsx`  | 3-line re-export barrel for the three consumer-facing sections. Inner sub-sections (state summary, invite, message, close) are **not** re-exported.                                  | 3             |

### State hook and its spec

| File                                          | Responsibility                                                                                                                                                                            | Approx. lines |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `war-room-manager-state.hooks.ts`              | `useWarRoomManagerState` — consolidated local-form-state hook. Exposes the 10 state values + 10 setters (selected session id, open-session id + initial message, invite profile + role, message kind + body, close resolution type + note, notice). | 48 |
| `war-room-manager-state.hooks.spec.ts`         | Unit spec for `useWarRoomManagerState`: initial values, each setter updates only its own field, identity stability for unrelated setters, immutability of the previously observed snapshot, and an explicit guard that no compound reset actions have been introduced.                                                | 281           |

### Query and mutation hooks (siblings to the panel)

| File                                          | Responsibility                                                                                                                                                                            | Approx. lines |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `war-room-sessions-query.hooks.ts`            | `useWarRoomSessionsQuery` (lists sessions with 10 s polling), `useSyncSelectedSession` (keeps `selectedSessionId` in sync with the loaded list), `useWarRoomSessionStateQuery` (per-session state, gated by selection). | 51  |
| `war-room-mutations.hooks.ts`                 | `useWarRoomMutations` — bundles the four mutations (`openSession`, `inviteParticipant`, `postMessage`, `closeSession`) with shared `refreshWarRoomData` and `setNotice`.                 | 117           |

### Section components and their composer

| File                                          | Responsibility                                                                                                                                                                                                                                                                              | Approx. lines |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `war-room-open-session-section.tsx`            | **Consumer-facing section.** Open-session form (id, initial message, "Open Session" button).                                                                                                                                                                                                | 50            |
| `war-room-session-selector-section.tsx`        | **Consumer-facing section.** Session selector (`Select`) driven by the `useSyncSelectedSession` invariant; shows loading / error / empty states.                                                                                                                                          | 58            |
| `war-room-state-summary-section.tsx`           | **Inner sub-section (not re-exported).** Renders the per-session state payload (loading, error, found counts, denial reason, generic fallback). Known as `WarRoomStateSummaryPanel` to preserve the existing component name in spec imports.                                            | 38            |
| `war-room-invite-section.tsx`                  | **Inner sub-section (not re-exported).** Invite form (agent profile + role + "Invite Participant" button). Exports `PARTICIPANT_ROLES` as a named export alongside `WarRoomInviteSection`.                                                                                              | 75            |
| `war-room-message-section.tsx`                 | **Inner sub-section (not re-exported).** Post-message form (kind + body + "Send Message" button). Exports `MESSAGE_KINDS`.                                                                                                                                                                  | 74            |
| `war-room-close-section.tsx`                   | **Inner sub-section (not re-exported).** Close-session form (resolution type + note + destructive "Close Session" button). Exports `RESOLUTION_TYPES`.                                                                                                                                      | 74            |
| `war-room-selected-session-section.tsx`        | **Consumer-facing section — thin composer.** Renders session badges and lays out the four inner sub-sections in order. Imports the inner sub-sections directly; the top-level `WarRoomSessionManagerPanel` reaches the composer through the `.sections.tsx` barrel.                  | 52            |

### Spec for the consumer-facing composer

| File                                          | Responsibility                                                                                                                                            | Lines |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `war-room-selected-session.spec.tsx`          | Spec covering all four inner sub-sections (`WarRoomStateSummaryPanel`, `WarRoomInviteSection`, `WarRoomMessageSection`, `WarRoomCloseSection`) and their composer-time wiring. | 281   |

### Folder-level conventions for future sub-sections

When adding a **new sub-section** to the
`WarRoomSelectedSessionSection` composer, follow these rules:

- **Naming**: use `war-room-<concern>-section.tsx` (lowercase,
  hyphen-separated, `section.tsx` suffix). PascalCase component
  name: `WarRoom<Concern>Section`.
- **Props typing**: declare an `interface <SectionName>Props`
  inline at the top of the file, then destructure the function
  argument using `Readonly<<SectionName>Props>`. Never widen the
  prop shape with index signatures or optional spreads — the
  composer must pass every field explicitly so call sites stay
  greppable.
- **Exports**: **named exports only** (`export function`, not
  `export default`). Constants (such as `MESSAGE_KINDS`,
  `PARTICIPANT_ROLES`, `RESOLUTION_TYPES`) live alongside their
  component as named exports and are imported by the spec directly.
- **Composition**: inner sub-sections return their UI as a
  `<>` / `<div>` fragment and rely on the composer for outer
  borders and spacing. Do not wrap a sub-section in another
  `<div className="border ...">`.
- **Re-export policy**: do **not** add new exports to
  `WarRoomSessionManagerPanel.sections.tsx`. Only the three
  consumer-facing sections (`Open`, `Selector`, `Selected`)
  are surfaced there. Inner sub-sections are private to the
  composer and the spec.
- **State**: do not introduce new `useState` calls inside the
  sub-sections. New form fields must go through
  `useWarRoomManagerState` (extend the state hook, its spec,
  the `WarRoomManagerState` type in
  `WarRoomSessionManagerPanel.types.ts`, and the
  `WarRoomSessionManagerModel` shape in the same file).
- **Actions**: do not call `useMutation` directly from a
  sub-section. New actions go through `useWarRoomMutations`
  (extend `UseWarRoomMutationsParams` / `WarRoomMutationsResult`
  in the types file, add a `_mutation` helper in
  `war-room-mutations.hooks.ts`, and surface an action + pending
  flag through the model).

## Cross-references

- EPIC-207 — [Web UI Component Consistency and Theme Readiness](../epics/EPIC-207-web-ui-component-consistency-and-theme-readiness.md),
  which tracks the original decomposition plan (B11 / B15 etc.).
- EPIC-087 — [Chat Session Multi-Agent Runtime Orchestration](../epics/EPIC-087-chat-session-multi-agent-runtime-orchestration-and-turn-governance.md),
  which establishes the `WarRoomSessionManagerPanel` UX contract.
- Superpowers plan — [EPIC-207 Phase B Web UI Component Consistency](../superpowers/plans/2026-06-12-epic-207-phase-b-web-ui-component-consistency.md),
  the operative step-by-step plan for this decomposition.
- Plan — [Workflow YAML Agent Team War Rooms](../plans/2026-04-30-workflow-yaml-agent-team-war-rooms.md),
  which first identified the file as a candidate for splitting.
- Web quality gate —
  [`.github/instructions/web-quality-gate.instructions.md`](../../.github/instructions/web-quality-gate.instructions.md)
  for the lint / typing / test rules that any edit to these files
  must satisfy.

## Summary

The decomposition trades one 338-LOC file for eight files, each
under 200 LOC, with a stable contract between them. The two
top-level files (`WarRoomSessionManagerPanel.tsx` +
`WarRoomSessionManagerPanel.hooks.tsx`) are the only ones that
should be touched when adding a whole new panel capability.
Adding a new form field or action is a four-file diff (state
hook, types, mutations hook, model) plus the new sub-section.
Adding a new visible sub-section is a two-file diff (the
sub-section + composer). Stay inside those boundaries and the
test suite (`war-room-manager-state.hooks.spec.ts`,
`war-room-selected-session.spec.tsx`) will continue to pin the
behaviour.
