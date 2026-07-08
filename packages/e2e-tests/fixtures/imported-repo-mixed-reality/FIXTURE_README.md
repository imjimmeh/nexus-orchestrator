# Imported Repository Mixed Reality — Fixture Convention

This document is the convention guide for fixtures under
`packages/e2e-tests/fixtures/`. The
[`imported-repo-mixed-reality`](./README.md) fixture is the reference
implementation; new fixtures should mirror its shape so the E2E tests can
discover probe artefacts, source evidence, and human-decision inputs in a
predictable location.

## Layout

```
<fixture-name>/
  README.md                              # Project description (existing capability)
  FIXTURE_README.md                      # THIS file — convention + intent map
  package.json                           # Working linter configured (existing capability)
  tsconfig.json                          # Credible TypeScript project shape
  .gitignore                             # Standard Node/TS ignores
  src/
    index.ts                             # Entry point with a deliberate gap (gap → todo)
  tests/
    auth.test.ts                         # Deliberately broken assertion (defect → todo)
    some-test.ts                         # Companion broken test referenced by probe 04
  docs/
    decisions/
      pending.md                         # Human-decision evidence (blocked)
    project-context/
      probe-results/
        01-...-documentation.md          # Probe artefact: existing capability → done
        02-...-linter-config.md          # Probe artefact: existing capability → done
        03-...-missing-authentication.md # Probe artefact: gap → todo
        04-...-broken-test-suite.md      # Probe artefact: defect → todo
        05-...-pending-decision.md       # Probe artefact: human_decision → blocked
```

## Intent Map

| File                                         | Work Type            | Board Status | Notes |
|----------------------------------------------|----------------------|--------------|-------|
| `README.md`                                  | existing_capability  | done         | Project description, quick-start, license. |
| `package.json` (`lint` script + eslint dep)  | existing_capability  | done         | Working linter configured. |
| `src/index.ts`                               | gap                  | todo         | Missing authentication handling for `/api/users`. |
| `tests/auth.test.ts`                         | defect               | todo         | Asserts a 401 that the missing auth code cannot return. |
| `tests/some-test.ts`                         | defect               | todo         | Companion broken test referenced by probe 04. |
| `docs/decisions/pending.md`                  | human_decision       | blocked      | Explicitly blocked on a human product owner. |
| `docs/project-context/probe-results/*.md`    | (probe artefacts)    | (input)      | Eaten by `ImportedRepositoryBacklogReconciler`. |

## Conventions

- **One fixture per scenario.** Each fixture represents a single
  mixed-reality scenario. Multiple scenarios get multiple sibling
  directories, not nested sub-fixtures.
- **Probe artefact naming.** Probe result files are zero-padded,
  kebab-case, and sorted alphabetically. The reconciler discovers them by
  globbing `*.md` and sorting, so naming must be stable.
- **Probe → evidence binding.** Every `evidence_refs` entry in a probe
  result must point to a file that actually exists in the fixture, so the
  fixture can be diffed against the probe result without surprises.
- **Determinism.** No timestamps, random numbers, network calls, or
  environment-dependent content anywhere in the fixture. The reconciler
  hashes the probe artefact content to produce a stable `sourceId`, so
  even one byte of drift will change the hash and break determinism.
- **Linter must be runnable.** `npm run lint` exits 0 against the
  fixture, with the linter dependency declared in `devDependencies`.
- **TypeScript must be plausible.** `tsconfig.json` uses `strict: true`
  and the source compiles under `tsc --noEmit` (modulo the intentional
  broken tests, which only fail at runtime, not at type-check time).
- **Human-decision evidence.** The `docs/decisions/pending.md` file
  must explicitly state that the decision is blocked on a human. The
  reconciler keys off the language, not the filename, so a copy-paste
  of an existing pending-decision doc is the safe default.

## Adding a new fixture

1. Copy this directory to `packages/e2e-tests/fixtures/<new-fixture-name>/`.
2. Update `README.md`, `package.json` (`name`, `description`),
   and the probe result `project_scope_id` front-matter.
3. Adjust the source and test files to model the new scenario — keep
   exactly one deliberate gap, one deliberate defect, and one
   pending human decision, plus two existing capabilities.
4. Add a new `*.test.ts` under `packages/e2e-tests/src/` that loads
   the fixture and asserts the expected board shape.
5. Update this file's intent map to describe the new scenario.
