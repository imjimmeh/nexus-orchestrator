import type {
  ProbeResultArtifact,
  ProbeResultValidationResult,
} from "./probe-result-artifact.types";
export type {
  ProbeResultArtifact,
  ProbeResultValidationFailure,
  ProbeResultValidationSuccess,
  ProbeResultValidationResult,
} from "./probe-result-artifact.types";

function splitFrontmatterAndBody(content: string): {
  frontmatter: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: "", body: content };
  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  if (!raw) return {};

  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const arrayItemMatch = line.match(/^\s+-\s+(.*)$/);
    if (arrayItemMatch && currentArray !== null) {
      currentArray.push(arrayItemMatch[1].trim());
      continue;
    }

    if (currentKey && currentArray !== null) {
      result[currentKey] = currentArray;
      currentArray = null;
    }

    const kvMatch = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    currentKey = "";
    currentArray = null;

    if (value === "") {
      currentKey = key;
      currentArray = [];
      continue;
    }

    result[key] = parseScalarValue(value);
  }

  if (currentKey && currentArray !== null) {
    result[currentKey] = currentArray;
  }

  return result;
}

function parseScalarValue(value: string): string | number {
  const unquoted = unwrapQuotedScalar(value);
  const numeric = Number(unquoted);
  return Number.isNaN(numeric) ? unquoted : numeric;
}

function unwrapQuotedScalar(value: string): string {
  if (value.length < 2) return value;

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function extractMarkdownSection(
  body: string,
  heading: string,
): string | undefined {
  const headingPattern = new RegExp(
    `^#{1,6}\\s+${escapeRegex(heading)}\\s*$`,
    "m",
  );
  const startMatch = headingPattern.exec(body);
  if (!startMatch) return undefined;

  const startIndex = startMatch.index + startMatch[0].length;
  const headingMatch = startMatch[0].match(/^(#{1,6})/);
  if (!headingMatch?.[1]) return undefined;
  const headingLevel = headingMatch[1].length;

  const nextHeadingPattern = new RegExp(`^#{1,${headingLevel}}\\s+`, "m");
  const remaining = body.slice(startIndex);
  const nextMatch = nextHeadingPattern.exec(remaining);

  const sectionContent = nextMatch
    ? remaining.slice(0, nextMatch.index)
    : remaining;

  return sectionContent.trim() || undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalizeFrontmatter(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    mapped[snakeToCamel(key)] = value;
  }
  return mapped;
}

export function parseProbeResultArtifact(
  content: string,
  path: string,
): ProbeResultArtifact {
  const { frontmatter, body } = splitFrontmatterAndBody(content);
  const raw = parseFrontmatter(frontmatter);
  const n = normalizeFrontmatter(raw);

  const narrativeSummary =
    extractMarkdownSection(body, "Narrative Summary") ??
    (typeof n.narrativeSummary === "string" ? n.narrativeSummary : undefined);

  return {
    path,
    projectScopeId:
      typeof n.projectScopeId === "string" ? n.projectScopeId : undefined,
    probeScopeId:
      typeof n.probeScopeId === "string" ? n.probeScopeId : undefined,
    outcome: typeof n.outcome === "string" ? n.outcome : undefined,
    inferredStatus:
      typeof n.inferredStatus === "string" ? n.inferredStatus : undefined,
    confidenceScore:
      typeof n.confidenceScore === "number" ? n.confidenceScore : undefined,
    evidenceRefs: toStringArray(n.evidenceRefs),
    sourcePaths: toStringArray(n.sourcePaths),
    narrativeSummary,
    capabilityUpdates: extractMarkdownSection(body, "Capability Updates"),
    healthFindings: extractMarkdownSection(body, "Health Findings"),
    openQuestions: extractMarkdownSection(body, "Open Questions"),
  };
}

export function validateSuccessfulProbeResultArtifact(
  content: string,
  path: string,
): ProbeResultValidationResult {
  const artifact = parseProbeResultArtifact(content, path);

  const missingFields: string[] = [];
  const errors: string[] = [];

  if (!artifact.narrativeSummary || artifact.narrativeSummary.trim() === "") {
    missingFields.push("narrative_summary");
    errors.push("narrative_summary is required for successful probe results");
  }

  if (missingFields.length > 0) {
    return { ok: false, path, missingFields, errors };
  }

  return { ok: true, value: artifact };
}
