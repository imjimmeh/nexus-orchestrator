---
project_scope_id: imported-mixed-reality
probe_scope_id: broken-test-suite
outcome: partial
inferred_status: partial
confidence_score: 0.55
evidence_refs:
  - tests/some-test.ts
source_paths:
  - tests
---

# Probe Result: Broken Test Suite

## Narrative Summary

The repository includes a test file at `tests/some-test.ts`. The test asserts
that the parser returns a sorted list of integers, but the parser implementation
returns the input list in reverse order. The assertion in the test is also
incorrect: it compares against a hard-coded expected value that does not match
either the actual or the intended behaviour. The test fails in deterministic
local runs.

## Capability Updates

| Capability                                          | Status      |
|-----------------------------------------------------|-------------|
| Test runner installed and configured                | Implemented |
| Test fixture file present                           | Implemented |
| Test asserts correct, deterministic behaviour       | Missing     |
| Parser implementation matches the asserted contract | Missing     |

## Health Findings

- Bug: tests/some-test.ts asserts the wrong expected value.
- Bug: src/parser.ts returns the input list reversed relative to the contract
  documented in the test.
- Test gap: no regression coverage that locks down the parser ordering.
- Recommended fix: align the parser and the assertion with the documented
  contract, and add a regression test that exercises an empty input and a
  single-element input.
