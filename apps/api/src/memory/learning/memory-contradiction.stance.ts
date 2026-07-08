import type { OpposingStance } from './memory-contradiction.types';

/**
 * Pure, deterministic opposing-stance heuristic for the
 * `MemoryContradictionService` (EPIC-212 Phase-3 Task 5).
 *
 * Given two memory contents already known to be near-neighbours in vector
 * space, classify how the NEW content relates to the EXISTING one:
 *   - `oppose`    — a contradictory claim on the same topic.
 *   - `refine`    — an extension / refinement of the same topic.
 *   - `same`      — semantically the same claim (a dedup, not a contradiction).
 *   - `ambiguous` — overlapping but unclear; routed to a human diff.
 *
 * The heuristic is intentionally conservative and explainable (no LLM): the
 * `MemoryContradictionService` only escalates the `ambiguous` verdict to a
 * bounded LLM confirm. Everything here is referentially transparent so the
 * full decision matrix is unit-testable.
 */

const STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'to',
  'for',
  'of',
  'is',
  'are',
  'be',
  'this',
  'that',
  'and',
  'or',
  'in',
  'on',
  'at',
  'with',
  'as',
  'by',
  'it',
  'we',
  'you',
  'should',
  'when',
  'if',
]);

/**
 * Negation markers. Presence asymmetry (one side negates, the other does not)
 * over a shared topic is a strong contradiction signal.
 */
const NEGATION_MARKERS: ReadonlySet<string> = new Set([
  'not',
  'no',
  'never',
  'cannot',
  'cant',
  'dont',
  'doesnt',
  'wont',
  'without',
  'avoid',
  'disable',
  'disabled',
  'stop',
]);

/** Antonym pairs — presence on opposite sides over a shared topic ⇒ oppose. */
const ANTONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['always', 'never'],
  ['enable', 'disable'],
  ['enabled', 'disabled'],
  ['allow', 'deny'],
  ['allowed', 'denied'],
  ['increase', 'decrease'],
  ['prefer', 'avoid'],
  ['on', 'off'],
  ['true', 'false'],
  ['add', 'remove'],
  ['include', 'exclude'],
  ['safe', 'unsafe'],
  ['valid', 'invalid'],
  ['before', 'after'],
];

/** Jaccard floor for treating a negation/numeric divergence as same-topic. */
const TOPIC_OVERLAP_MIN = 0.5;
/** Jaccard floor (without a subset relation) for a refinement verdict. */
const REFINE_OVERLAP_MIN = 0.6;

const NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;

export function detectOpposingStance(
  newContent: string,
  existingContent: string,
): OpposingStance {
  const a = normalize(newContent);
  const b = normalize(existingContent);
  if (a === b) {
    return 'same';
  }

  const tokensA = contentTokens(a);
  const tokensB = contentTokens(b);
  if (setsEqual(tokensA, tokensB)) {
    return 'same';
  }

  if (hasAntonymOpposition(tokensA, tokensB)) {
    return 'oppose';
  }
  if (hasNumericMismatch(tokensA, tokensB)) {
    return 'oppose';
  }
  if (hasNegationAsymmetry(tokensA, tokensB)) {
    return 'oppose';
  }
  if (isRefinement(tokensA, tokensB)) {
    return 'refine';
  }
  return 'ambiguous';
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function contentTokens(normalized: string): Set<string> {
  const tokens = normalized.length === 0 ? [] : normalized.split(' ');
  return new Set(tokens.filter((t) => t.length > 0 && !STOPWORDS.has(t)));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function hasAntonymOpposition(a: Set<string>, b: Set<string>): boolean {
  return ANTONYM_PAIRS.some(
    ([x, y]) => (a.has(x) && b.has(y)) || (a.has(y) && b.has(x)),
  );
}

function numbersIn(tokens: Set<string>): Set<string> {
  return new Set([...tokens].filter((t) => NUMBER_PATTERN.test(t)));
}

function nonNumericContent(tokens: Set<string>): Set<string> {
  return new Set(
    [...tokens].filter(
      (t) => !NUMBER_PATTERN.test(t) && !NEGATION_MARKERS.has(t),
    ),
  );
}

function hasNumericMismatch(a: Set<string>, b: Set<string>): boolean {
  const numsA = numbersIn(a);
  const numsB = numbersIn(b);
  if (numsA.size === 0 || numsB.size === 0 || setsEqual(numsA, numsB)) {
    return false;
  }
  return (
    jaccard(nonNumericContent(a), nonNumericContent(b)) >= TOPIC_OVERLAP_MIN
  );
}

function hasNegation(tokens: Set<string>): boolean {
  for (const marker of NEGATION_MARKERS) {
    if (tokens.has(marker)) {
      return true;
    }
  }
  return false;
}

function hasNegationAsymmetry(a: Set<string>, b: Set<string>): boolean {
  if (hasNegation(a) === hasNegation(b)) {
    return false;
  }
  return (
    jaccard(nonNumericContent(a), nonNumericContent(b)) >= TOPIC_OVERLAP_MIN
  );
}

function isSubset(inner: Set<string>, outer: Set<string>): boolean {
  if (inner.size === 0) {
    return false;
  }
  for (const value of inner) {
    if (!outer.has(value)) {
      return false;
    }
  }
  return true;
}

function isRefinement(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size && (isSubset(a, b) || isSubset(b, a))) {
    return true;
  }
  return jaccard(a, b) >= REFINE_OVERLAP_MIN;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
