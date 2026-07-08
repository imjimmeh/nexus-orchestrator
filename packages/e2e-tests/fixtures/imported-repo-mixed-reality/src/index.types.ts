/**
 * Type definitions for the imported-repository mixed-reality fixture's
 * `src/index.ts` entry point.
 *
 * The fixture's `src/index.ts` is intentionally a "real" TypeScript service
 * with a deliberate authentication gap. The types live in this sibling file
 * so the linter is happy (no exported interfaces inside `src/index.ts`)
 * while the runtime shape is unchanged.
 */

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

export interface UsersResponse {
  readonly users: readonly UserRecord[];
  readonly total: number;
}

export interface IncomingRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}
