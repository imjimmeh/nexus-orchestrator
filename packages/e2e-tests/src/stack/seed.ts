// packages/e2e-tests/src/stack/seed.ts
import pg from "pg";

// The deterministic admin user UUID used by all e2e tests.
// Must match E2E_ADMIN_USER_ID in packages/e2e-tests/src/driver/auth.ts.
const E2E_ADMIN_USER_ID = "00000000-e2e0-4000-a000-000000000001";
const E2E_ADMIN_USERNAME = "e2e-admin";
const E2E_ADMIN_EMAIL = "e2e-admin@nexus-test.local";

// The global scope node ID that grants platform-wide permissions.
const GLOBAL_SCOPE_NODE_ID = "00000000-0000-0000-0000-000000000000";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(
  connectionString: string,
  maxAttempts = 10,
): Promise<pg.Client> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 15_000,
    });
    client.on("error", () => undefined);
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts) {
        throw new Error(
          `DB connection failed after ${maxAttempts} attempts: ${message}`,
          { cause: err },
        );
      }
      console.warn(
        `[seed] DB connect attempt ${attempt} failed (${message}), retrying in 3s…`,
      );
      await sleep(3_000);
    }
  }
  throw new Error("Unreachable");
}

/**
 * Seed the e2e admin user and assign them the `admin` role at the global scope.
 * This must be called AFTER the API container has started (migrations have run).
 * The API's JWT strategy has a non-production fallback that accepts tokens for
 * users that don't exist in the DB — but the Kanban permissions guard calls
 * GET /me/permissions which queries role_assignments, so the user must exist
 * there to have any permissions.
 */
export async function seedAdminUser(connectionString: string): Promise<void> {
  let client: pg.Client | null = null;
  try {
    client = await connectWithRetry(connectionString);

    // 1. Create the test user if it doesn't exist.
    // NOTE: TypeORM created the column as "isActive" (camelCase) rather than
    // "is_active" (snake_case) because the entity's @Column decorator has no
    // explicit name override. The baseline migration confirms this.
    await client.query(
      `
      INSERT INTO users (id, username, email, password_hash, "isActive")
      VALUES ($1, $2, $3, 'e2e-test-hash-not-a-real-password', true)
      ON CONFLICT (id) DO NOTHING
      `,
      [E2E_ADMIN_USER_ID, E2E_ADMIN_USERNAME, E2E_ADMIN_EMAIL],
    );

    // 2. Resolve the `admin` role ID (seeded by the API's startup seed service)
    const roleResult = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'admin' LIMIT 1`,
    );
    if (roleResult.rows.length === 0) {
      console.warn(
        "[seed] admin role not found in DB — permissions guard will deny all requests",
      );
      return;
    }
    const adminRoleId = roleResult.rows[0].id;

    // 3. Assign admin role at the global scope node.
    // The uniqueness is enforced by a unique INDEX (not a table CONSTRAINT),
    // so we must use ON CONFLICT (columns) rather than ON CONFLICT ON CONSTRAINT.
    await client.query(
      `
      INSERT INTO role_assignments (user_id, role_id, scope_node_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, role_id, scope_node_id) DO NOTHING
      `,
      [E2E_ADMIN_USER_ID, adminRoleId, GLOBAL_SCOPE_NODE_ID],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Non-fatal: the JWT strategy fallback still allows basic API access.
    // A DB connection failure here means the Kanban permissions guard will
    // return 403 on all requests, but the core API tests will still run.
    console.warn(`[seed] seedAdminUser: ${message}`);
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/**
 * Pre-API seed: runs before the API container starts.
 * At this point migrations haven't run yet, so we skip table-level inserts
 * and let the API seed itself via SEED_LLM_SECRET_FROM_ENV / E2E_PROVIDER_* env vars.
 */
export function seedAnthropicProvider(
  _connectionString: string,
  _fakeLlmUrl: string,
): void {
  // The API is configured via SEED_LLM_SECRET_FROM_ENV=true + E2E_PROVIDER_*
  // environment variables and seeds the LLM provider on startup — no pre-seed needed.
  // This function is kept for interface compatibility but does nothing.
}
