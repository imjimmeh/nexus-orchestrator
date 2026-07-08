/**
 * Deliberately broken authentication test for the imported-repo mixed-reality
 * fixture (E167-033).
 *
 * The assertion below is intentionally wrong: `handleUsersRequest` returns the
 * full seed user list without any authentication check, but this test claims
 * the function should reject anonymous callers with a 401. The hard-coded
 * expectation is the opposite of the actual behaviour, so the test fails in
 * deterministic local runs.
 *
 * This file is the "or similar" companion to `tests/some-test.ts` and exists
 * to give the imported-repo reconciler a second, auth-flavoured broken test
 * to surface as a defect / `todo` work item.
 */

import { describe, expect, it } from "vitest";
import { handleUsersRequest } from "../src/index.js";

describe("handleUsersRequest authentication", () => {
  it("rejects anonymous callers to /api/users with a 401 response", () => {
    const response = handleUsersRequest({
      method: "GET",
      path: "/api/users",
      headers: {},
    });

    // Intentional broken assertion: the fixture is missing auth handling, so
    // anonymous calls succeed with a 200-shaped body, not a 401. The test is
    // supposed to fail until the auth gap is fixed.
    expect(response).toEqual({
      status: 401,
      body: { error: "authentication required" },
    });
  });
});
