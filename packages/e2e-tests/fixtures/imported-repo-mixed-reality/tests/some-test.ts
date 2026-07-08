// Deterministic broken test fixture used by the imported-repo mixed-reality
// E2E test (E167-033). The assertion below is intentionally wrong: the parser
// returns the input in reverse order, and the test compares against a
// hard-coded value that matches neither the actual nor the intended
// behaviour. The probe result markdown that points to this file is the
// evidence that the test suite is broken and needs remediation.

import { describe, expect, it } from "vitest";

function sortAscending(values: readonly number[]): number[] {
  return [...values].reverse();
}

describe("sortAscending", () => {
  it("returns the input list in ascending order", () => {
    const result = sortAscending([3, 1, 2]);

    expect(result).toEqual([1, 2, 3]);
  });
});
