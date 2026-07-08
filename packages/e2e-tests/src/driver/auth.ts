// packages/e2e-tests/src/driver/auth.ts
import jwt, { type SignOptions } from "jsonwebtoken";

// A stable deterministic UUID used as the "admin" user for e2e tests.
// The API's non-production fallback (NODE_ENV=test) accepts tokens where
// the user does not exist in the DB, provided the JWT is valid and has roles.
// The sub must be a UUID so it doesn't cause "invalid input syntax for type
// uuid" DB errors in queries that filter by user_id.
const E2E_ADMIN_USER_ID = "00000000-e2e0-4000-a000-000000000001";

export function buildAdminToken(
  jwtSecret: string,
  expiresIn: SignOptions["expiresIn"] = "2h",
): string {
  return jwt.sign(
    { sub: E2E_ADMIN_USER_ID, role: "Admin", roles: ["Admin"] },
    jwtSecret,
    { expiresIn },
  );
}

export function buildAgentToken(
  jwtSecret: string,
  payload: { workflowRunId: string; jobId: string; stepId: string },
): string {
  return jwt.sign(
    {
      sub: `agent:${payload.workflowRunId}:${payload.jobId}`,
      workflowRunId: payload.workflowRunId,
      role: "agent",
      stepId: payload.stepId,
      jobId: payload.jobId,
      roles: ["Agent"],
    },
    jwtSecret,
    { expiresIn: "2h" as SignOptions["expiresIn"] },
  );
}
