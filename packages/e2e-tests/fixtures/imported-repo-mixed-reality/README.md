# Imported Repository Mixed Reality Fixture

A deterministic fixture for the imported repository E2E test (E167-033). The
fixture models an existing repository with a mix of implemented capabilities,
local gaps, broken tests, and a pending product decision. The probe result
markdowns under `docs/project-context/probe-results/` are the inputs the
`ImportedRepositoryBacklogReconciler` ingests to produce a mixed board state.

## Layout

```
docs/
  project-context/
    probe-results/
      01-readme-documentation.md          # existing capability  -> done
      02-eslint-linter-config.md          # existing capability  -> done
      03-missing-authentication.md        # gap                  -> todo
      04-broken-test-suite.md             # defect / test gap    -> todo
      05-pending-product-decision.md      # open question        -> blocked
  decisions/
    pending.md                            # source evidence for the blocked item
```

## Determinism Guarantees

- All probe result files are checked in and contain no time, random, or
  network-dependent content.
- The reconciler hashes the probe artifact content and emits a stable
  `sourceId` per `(projectId, workType, scopeId)`, so the same fixture
  produces the same board state on every run.
