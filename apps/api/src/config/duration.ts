/**
 * Parse a duration expression into a positive integer number of seconds.
 *
 * @remarks
 * Accepted shapes (whitespace trimmed):
 * - A bare integer or numeric string is interpreted as **seconds** (e.g.
 *   `900`, `"900"`). Bare numerics are never minutes or days.
 * - A `<integer><unit>` string where `unit` ∈ `s` | `m` | `h` | `d`.
 *
 * The supported unit set is intentionally tight — `s`, `m`, `h`, and `d`
 * only. Decimals, negative numbers, zero, empty/whitespace-only strings,
 * and any other unit (including `ms`, `w`, `y`) are rejected.
 *
 * @param raw - The value to parse. May be a number or string.
 * @returns A positive integer number of seconds.
 * @throws {Error} If `raw` is not a parseable duration. The message
 *   includes the function name (`parseDurationToSeconds`) and the offending
 *   input value.
 */
export function parseDurationToSeconds(raw: unknown): number {
  if (typeof raw === 'number') {
    return parseFinitePositiveSeconds(raw);
  }
  if (typeof raw !== 'string') {
    throw invalid(raw, 'must be a string or number');
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw invalid(raw, 'must be a non-empty duration string');
  }

  const match = /^(\d+)([smhd])?$/u.exec(trimmed);
  if (match === null) {
    throw invalid(raw, 'is not a valid duration');
  }

  const amount = Number.parseInt(match[1], 10);
  if (amount <= 0) {
    throw invalid(raw, 'must be greater than zero');
  }

  const unit = match[2] ?? '';
  return amount * UNIT_TO_SECONDS[unit];
}

function parseFinitePositiveSeconds(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw invalid(value, 'must be a finite integer');
  }
  if (value <= 0) {
    throw invalid(value, 'must be greater than zero');
  }
  return value;
}

const UNIT_TO_SECONDS: Readonly<Record<string, number>> = {
  '': 1,
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
};

function invalid(value: unknown, reason: string): Error {
  return new Error(
    `parseDurationToSeconds: invalid duration ${render(value)} (${reason})`,
  );
}

function render(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'undefined') {
    return 'undefined';
  }
  return JSON.stringify(value) ?? `<${typeof value}>`;
}
