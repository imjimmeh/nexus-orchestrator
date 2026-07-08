/**
 * Deterministic E2E test for the imported-repository "mixed reality" path
 * (work item WI-2026-006 / milestone E167-033).
 *
 * Goal
 * ----
 * Prove that when a repository with a known, deliberately mixed shape
 * (existing capabilities, gaps, defects, and a human-decision blocker) is
 * imported, the resulting Kanban board reflects the right *distribution* of
 * statuses, and the right *evidence* — not just non-emptiness.
 *
 * Fixture layout (see packages/e2e-tests/fixtures/imported-repo-mixed-reality/
 * for the full intent map):
 *   README.md                       existing capability  -> done
 *   package.json (lint + eslint)    existing capability  -> done
 *   src/index.ts (missing auth)     gap                  -> todo
 *   tests/auth.test.ts (broken)     defect               -> todo
 *   tests/some-test.ts (broken)     defect companion     -> (referenced by probe 04)
 *   docs/decisions/pending.md       human_decision       -> blocked
 *   docs/project-context/probe-results/*.md              (probe artifacts consumed
 *                                                         by the reconciler)
 *
 * The test is grouped into the following acceptance-criterion sections:
 *   AC-1: Import the fixture
 *   AC-2: Investigation runs to completion (deterministic, no sleeps)
 *   AC-3: Probe artifacts (capability map, health findings, open questions)
 *   AC-4: Board status distribution (done / todo / blocked)
 *   AC-5: Evidence assertions (artifact path + refs per item) + regression
 *         guards (non-human-decision items must NOT be blocked)
 *   AC-6: Determinism + cycle decision
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The relative imports below reach across the workspace boundary into
// `apps/kanban`, which is a CommonJS package (no `"type": "module"` in its
// `package.json`). NodeNext module resolution therefore refuses to follow the
// `.js` extension to the corresponding `.ts` source, even though vitest's
// runtime resolver does so transparently. The `apps/kanban` source files are
// included in the e2e-tests tsconfig program, so the symbols are real at
// runtime and at type-check time — the resolver just needs an explicit nudge.
import {
  ImportedRepositoryBacklogReconciler,
  type ImportedRepositoryBacklogReconciliationPlan,
  type RepositoryWorkItemSpec,
  type WorkItemStatus,
  type WorkType,
  // @ts-expect-error -- cross-workspace relative import; see comment above.
} from "../../apps/kanban/src/orchestration/imported-repository-backlog-reconciler.js";
import {
  parseProbeResultArtifact,
  type ProbeResultArtifact,
  // @ts-expect-error -- cross-workspace relative import; see comment above.
} from "../../apps/kanban/src/orchestration/probe-result-artifact.js";

// ---------------------------------------------------------------------------
// Fixture + project context resolution
// ---------------------------------------------------------------------------

/**
 * Absolute path to the imported-repository fixture root. The "import flow" in
 * this test points at this directory and the reconciler discovers probe
 * artifacts underneath it deterministically (sorted, glob `*.md`).
 *
 * `import.meta.url` in vitest resolves to the on-disk path of this test file
 * (e.g. `…/packages/e2e-tests/src/imported-repo-mixed-reality.test.ts`), so
 * `..` `..` from the file gives the `packages/e2e-tests/` directory.
 */
const FIXTURE_ROOT = resolve(
  join(
    fileURLToPath(import.meta.url),
    "..",
    "..",
    "fixtures",
    "imported-repo-mixed-reality",
  ),
);

/**
 * Probe artifacts live under `<fixture>/docs/project-context/probe-results/`
 * — see FIXTURE_README.md in the fixture for the convention.
 */
const PROBE_RESULTS_ROOT = join(
  FIXTURE_ROOT,
  "docs",
  "project-context",
  "probe-results",
);

const PROJECT_ID = "imported-mixed-reality";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadProbeArtifacts(probeRoot: string): ProbeResultArtifact[] {
  const entries = readdirSync(probeRoot)
    .filter((name) => name.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));
  return entries.map((name) => {
    const absolutePath = join(probeRoot, name);
    const content = readFileSync(absolutePath, "utf-8");
    return parseProbeResultArtifact(content, absolutePath);
  });
}

function reconcileFixture(
  probeRoot: string = PROBE_RESULTS_ROOT,
): ImportedRepositoryBacklogReconciliationPlan {
  const artifacts = loadProbeArtifacts(probeRoot);
  const reconciler = new ImportedRepositoryBacklogReconciler();
  return reconciler.reconcile({
    projectId: PROJECT_ID,
    artifacts,
  });
}

function specsByStatus(
  plan: ImportedRepositoryBacklogReconciliationPlan,
): Record<WorkItemStatus, RepositoryWorkItemSpec[]> {
  const grouped: Record<WorkItemStatus, RepositoryWorkItemSpec[]> = {
    done: [],
    todo: [],
    blocked: [],
  };
  for (const spec of plan.specs) {
    grouped[spec.status].push(spec);
  }
  return grouped;
}

function findSpec(
  plan: ImportedRepositoryBacklogReconciliationPlan,
  probeScopeId: string,
) {
  return [...plan.specs].find(
    (spec) => spec.evidence.probeScopeId === probeScopeId,
  );
}

// ---------------------------------------------------------------------------
// AC-1: Import the fixture
// ---------------------------------------------------------------------------

describe("AC-1: import the imported-repo-mixed-reality fixture", () => {
  it("resolves the fixture root and the probe-results subdirectory on disk", () => {
    expect(isAbsolute(FIXTURE_ROOT)).toBe(true);
    expect(existsSync(FIXTURE_ROOT)).toBe(true);
    expect(statSync(FIXTURE_ROOT).isDirectory()).toBe(true);

    expect(existsSync(PROBE_RESULTS_ROOT)).toBe(true);
    expect(statSync(PROBE_RESULTS_ROOT).isDirectory()).toBe(true);

    // The fixture root must contain the canonical mixed-reality inputs.
    for (const relativePath of [
      "README.md",
      "package.json",
      "src/index.ts",
      "tests/auth.test.ts",
      "tests/some-test.ts",
      "docs/decisions/pending.md",
      "docs/project-context/probe-results/01-readme-documentation.md",
      "docs/project-context/probe-results/02-eslint-linter-config.md",
      "docs/project-context/probe-results/03-missing-authentication.md",
      "docs/project-context/probe-results/04-broken-test-suite.md",
      "docs/project-context/probe-results/05-pending-product-decision.md",
    ]) {
      const absolute = join(FIXTURE_ROOT, relativePath);
      expect(
        existsSync(absolute),
        `expected fixture file to exist: ${relativePath}`,
      ).toBe(true);
    }
  });

  it("loads every deterministic probe artifact from the fixture", () => {
    const artifacts = loadProbeArtifacts(PROBE_RESULTS_ROOT);

    expect(artifacts).toHaveLength(5);
    const titles = artifacts.map((artifact) => artifact.probeScopeId).sort();
    expect(titles).toEqual([
      "broken-test-suite",
      "eslint-linter-config",
      "missing-authentication",
      "pending-product-decision",
      "readme-documentation",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Investigation runs to completion (deterministic, no sleeps)
// ---------------------------------------------------------------------------

describe("AC-2: investigation runs to a deterministic terminal state", () => {
  it("runs the reconciler end-to-end and produces a non-empty plan", () => {
    // The reconciler is synchronous: it maps every artifact to a spec in a
    // single pass and emits a cycle decision at the end. No polling, no
    // sleeps — the function returning is the terminal state.
    const plan = reconcileFixture();

    expect(plan.specs.length).toBeGreaterThan(0);
    expect(plan.findings).toHaveLength(plan.specs.length);
    expect(plan.diagnostics.artifactCount).toBe(5);
    expect(plan.diagnostics.mappedSpecs).toBe(plan.specs.length);
    expect(plan.diagnostics.mappedFindings).toBe(plan.specs.length);
    expect(plan.counts.total).toBe(plan.specs.length);
  });

  it("derives a cycle decision from the per-status counts", () => {
    const plan = reconcileFixture();

    // The plan must include a terminal cycle decision — the import is
    // "done" when reconcile() returns.
    expect(plan.cycleDecision).toBeDefined();
    expect(["repeat", "pause", "complete", "blocked"]).toContain(
      plan.cycleDecision.decision,
    );
    expect(typeof plan.cycleDecision.reason).toBe("string");
    expect(plan.cycleDecision.reason.length).toBeGreaterThan(0);
    expect(typeof plan.cycleDecision.readyForCycle).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Probe artifacts (capability map / health findings / open questions)
// ---------------------------------------------------------------------------

describe("AC-3: probe artifacts cover capability map, health, and questions", () => {
  it("emits a capability map (narrative summary) for high-confidence done items", () => {
    const artifacts = loadProbeArtifacts(PROBE_RESULTS_ROOT);

    const capabilityMap = artifacts.filter(
      (artifact) =>
        artifact.outcome === "success" &&
        artifact.inferredStatus === "implemented" &&
        artifact.narrativeSummary !== undefined,
    );
    expect(capabilityMap.length).toBeGreaterThanOrEqual(2);

    const mapScopes = capabilityMap
      .map((artifact) => artifact.probeScopeId)
      .sort();
    expect(mapScopes).toEqual(["eslint-linter-config", "readme-documentation"]);
  });

  it("emits health findings for the gap and defect probes", () => {
    const artifacts = loadProbeArtifacts(PROBE_RESULTS_ROOT);

    const healthFindings = artifacts.filter(
      (artifact) =>
        artifact.healthFindings !== undefined &&
        artifact.healthFindings.trim().length > 0,
    );
    expect(healthFindings.length).toBeGreaterThanOrEqual(2);

    const healthScopes = healthFindings
      .map((artifact) => artifact.probeScopeId)
      .sort();
    // The gap and defect probes MUST be in the health-findings set. The
    // pending-product-decision probe may also surface health findings
    // (it surfaces open questions too), so we assert containment, not
    // strict equality.
    expect(healthScopes).toContain("broken-test-suite");
    expect(healthScopes).toContain("missing-authentication");
  });

  it("emits open questions only from the human-decision probe", () => {
    const artifacts = loadProbeArtifacts(PROBE_RESULTS_ROOT);

    const openQuestions = artifacts.filter(
      (artifact) =>
        artifact.openQuestions !== undefined &&
        artifact.openQuestions.trim().length > 0,
    );
    expect(openQuestions).toHaveLength(1);
    expect(openQuestions[0]?.probeScopeId).toBe("pending-product-decision");
  });
});

// ---------------------------------------------------------------------------
// AC-4: Board status distribution
// ---------------------------------------------------------------------------

describe("AC-4: board status distribution matches the mixed-reality fixture", () => {
  it("classifies existing capabilities as done (exactly 2)", () => {
    const plan = reconcileFixture();
    const done = specsByStatus(plan).done;

    expect(done).toHaveLength(2);
    const doneScopes = done
      .map((spec) => spec.evidence.probeScopeId ?? "")
      .sort();
    expect(doneScopes).toEqual([
      "eslint-linter-config",
      "readme-documentation",
    ]);
    for (const spec of done) {
      expect(spec.workType).toBe<WorkType>("existing_capability");
      expect(spec.status).toBe<WorkItemStatus>("done");
    }
  });

  it("classifies local gaps and broken capabilities as todo (exactly 2)", () => {
    const plan = reconcileFixture();
    const todo = specsByStatus(plan).todo;

    expect(todo).toHaveLength(2);
    const todoScopes = todo
      .map((spec) => spec.evidence.probeScopeId ?? "")
      .sort();
    expect(todoScopes).toEqual(["broken-test-suite", "missing-authentication"]);
    for (const spec of todo) {
      expect(spec.workType).toBe<WorkType>("gap");
      expect(spec.status).toBe<WorkItemStatus>("todo");
    }
  });

  it("classifies human-decision findings as blocked (exactly 1, no others)", () => {
    const plan = reconcileFixture();
    const blocked = specsByStatus(plan).blocked;

    expect(blocked).toHaveLength(1);
    const blockedSpec = blocked[0];
    expect(blockedSpec).toBeDefined();
    expect(blockedSpec?.workType).toBe<WorkType>("human_decision");
    expect(blockedSpec?.status).toBe<WorkItemStatus>("blocked");
    expect(blockedSpec?.evidence.probeScopeId).toBe("pending-product-decision");
  });

  it("matches the totals declared in the fixture intent map", () => {
    const plan = reconcileFixture();

    expect(plan.counts).toEqual({
      total: 5,
      done: 2,
      todo: 2,
      blocked: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// AC-5: Evidence assertions + regression guards
// ---------------------------------------------------------------------------

describe("AC-5: evidence on every spec + regression guards", () => {
  it("attaches a real on-disk artifact path to every todo and blocked spec", () => {
    const plan = reconcileFixture();
    const actionable = [...plan.specs].filter(
      (spec) => spec.status === "todo" || spec.status === "blocked",
    );

    expect(actionable.length).toBeGreaterThan(0);
    for (const spec of actionable) {
      const sourceId = spec.sourceId;

      // The artifact path must resolve to a real file under the fixture
      // tree — that's the strongest "evidence points at a real path"
      // guarantee we can make in this test.
      const artifactPath = spec.evidence.artifactPath;
      expect(
        artifactPath,
        `spec ${sourceId}: artifactPath is missing`,
      ).toBeTruthy();
      expect(
        artifactPath.endsWith(".md"),
        `spec ${sourceId}: artifactPath should point at a probe markdown (got ${artifactPath})`,
      ).toBe(true);
      expect(
        existsSync(artifactPath),
        `spec ${sourceId}: artifactPath does not resolve to a real file (${artifactPath})`,
      ).toBe(true);

      // Probe scope, source paths, and evidence refs must all be present.
      expect(
        spec.evidence.probeScopeId,
        `spec ${sourceId}: probeScopeId is missing`,
      ).toBeTruthy();
      expect(
        spec.evidence.evidenceRefs.length,
        `spec ${sourceId}: evidenceRefs is empty`,
      ).toBeGreaterThan(0);
      expect(
        spec.evidence.sourcePaths.length,
        `spec ${sourceId}: sourcePaths is empty`,
      ).toBeGreaterThan(0);

      // At least one of the evidence references must point inside the
      // fixture (e.g. src/index.ts, tests/auth.test.ts,
      // docs/decisions/pending.md) — fail with the offending sourceId
      // so the regression is easy to triage.
      const evidenceRefs = [...spec.evidence.evidenceRefs];
      const pointsInsideFixture = evidenceRefs.some((ref) => {
        // The ref may be a bare path (e.g. "src/index.ts") — combine it
        // with the fixture root and verify the resulting file exists.
        if (isAbsolute(ref)) {
          return existsSync(ref);
        }
        return existsSync(join(FIXTURE_ROOT, ref));
      });
      expect(
        pointsInsideFixture,
        `spec ${sourceId}: no evidence ref points to a real file inside the fixture (refs: ${evidenceRefs.join(", ")})`,
      ).toBe(true);
    }
  });

  it("attaches a capability map reference to every done spec", () => {
    const plan = reconcileFixture();
    const done = specsByStatus(plan).done;

    expect(done.length).toBeGreaterThan(0);
    for (const spec of done) {
      const sourceId = spec.sourceId;

      // A done item is the projection of a probe artifact's "capability
      // map" (narrative + capability updates). The reconciler must surface
      // at least one evidence ref and a non-trivial narrative so the done
      // item is auditable back to the capability it represents.
      expect(
        spec.evidence.evidenceRefs.length,
        `done spec ${sourceId}: missing capability-map evidence refs`,
      ).toBeGreaterThan(0);
      expect(
        spec.evidence.sourcePaths.length,
        `done spec ${sourceId}: missing capability-map source paths`,
      ).toBeGreaterThan(0);
      expect(
        spec.evidence.confidenceScore,
        `done spec ${sourceId}: missing confidence score`,
      ).toBeDefined();
      expect(
        spec.evidence.confidenceScore ?? 0,
        `done spec ${sourceId}: confidence score below the 0.8 threshold for done`,
      ).toBeGreaterThanOrEqual(0.8);
      expect(
        spec.evidence.narrativeSummary,
        `done spec ${sourceId}: missing narrativeSummary from capability map`,
      ).toBeTruthy();
      expect(
        spec.evidence.artifactPath.endsWith(".md"),
        `done spec ${sourceId}: artifactPath should reference a probe markdown`,
      ).toBe(true);
    }
  });

  // ---------------------------------------------------------------------
  // Regression guard (AC-5): non-human_decision items MUST NOT be blocked.
  // This is the named "auth-gap is todo, not blocked" check.
  // ---------------------------------------------------------------------
  it("regression: the auth-gap todo is todo, NOT blocked", () => {
    const plan = reconcileFixture();
    const authGap = findSpec(plan, "missing-authentication");

    expect(
      authGap,
      "regression: missing-authentication spec is missing from the plan",
    ).toBeDefined();
    expect(authGap?.status).toBe<WorkItemStatus>("todo");
    expect(authGap?.status).not.toBe<WorkItemStatus>("blocked");
    expect(authGap?.workType).toBe<WorkType>("gap");

    // The evidence on the auth gap must point at src/index.ts in the
    // fixture (the file with the missing auth handling).
    const evidenceRefs = [...(authGap?.evidence.evidenceRefs ?? [])];
    const pointsAtIndexTs = evidenceRefs.some(
      (ref) => ref === "src/index.ts" || ref.endsWith("/src/index.ts"),
    );
    expect(
      pointsAtIndexTs,
      `regression: auth-gap spec ${authGap?.sourceId} should cite src/index.ts (got: ${evidenceRefs.join(", ")})`,
    ).toBe(true);
  });

  it("regression: the broken-test-suite defect is todo, NOT blocked", () => {
    const plan = reconcileFixture();
    const brokenTests = findSpec(plan, "broken-test-suite");

    expect(brokenTests).toBeDefined();
    expect(brokenTests?.status).toBe<WorkItemStatus>("todo");
    expect(brokenTests?.status).not.toBe<WorkItemStatus>("blocked");
  });

  it("regression: the existing capabilities are done, NOT blocked", () => {
    const plan = reconcileFixture();

    for (const probeScopeId of [
      "readme-documentation",
      "eslint-linter-config",
    ]) {
      const spec = findSpec(plan, probeScopeId);
      expect(
        spec,
        `regression: ${probeScopeId} spec is missing from the plan`,
      ).toBeDefined();
      expect(spec?.status).toBe<WorkItemStatus>("done");
      expect(spec?.status).not.toBe<WorkItemStatus>("blocked");
    }
  });

  it("regression: only the human-decision spec is blocked (none of the others)", () => {
    const plan = reconcileFixture();
    const blocked = specsByStatus(plan).blocked;
    const blockedScopes = blocked
      .map((spec) => spec.evidence.probeScopeId ?? "")
      .sort();

    expect(blockedScopes).toEqual(["pending-product-decision"]);

    for (const nonHumanScope of [
      "missing-authentication",
      "broken-test-suite",
      "readme-documentation",
      "eslint-linter-config",
    ]) {
      expect(
        blockedScopes.includes(nonHumanScope),
        `regression: ${nonHumanScope} must not be blocked (a non-human-decision finding was misclassified)`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-6: Determinism + cycle decision
// ---------------------------------------------------------------------------

describe("AC-6: deterministic, source-hashed, cycle-aware reconciliation", () => {
  it("produces a deterministic, source-hashed plan across reruns", () => {
    const first = reconcileFixture();
    const second = reconcileFixture();

    expect(second.counts).toEqual(first.counts);
    expect(second.specs).toHaveLength(first.specs.length);

    const firstSourceIds = [...first.specs].map((spec) => spec.sourceId).sort();
    const secondSourceIds = [...second.specs]
      .map((spec) => spec.sourceId)
      .sort();
    expect(secondSourceIds).toEqual(firstSourceIds);

    const firstHashes = [...first.specs]
      .map((spec) => spec.metadata.sourceHash)
      .sort();
    const secondHashes = [...second.specs]
      .map((spec) => spec.metadata.sourceHash)
      .sort();
    expect(secondHashes).toEqual(firstHashes);
  });

  it("emits a cycle decision that respects the human-decision blocker", () => {
    const plan = reconcileFixture();

    expect(plan.cycleDecision.decision).toBe("blocked");
    expect(plan.cycleDecision.readyForCycle).toBe(false);
    expect(plan.cycleDecision.reason).toContain("1");
    expect(plan.cycleDecision.reason.toLowerCase()).toContain("human");
  });

  it("collects open questions only from the human-decision probe artifact", () => {
    const plan = reconcileFixture();

    expect(plan.openQuestions).toHaveLength(1);
    const normalized = plan.openQuestions[0]?.replaceAll(/\s+/g, " ") ?? "";
    expect(normalized).toContain("external identity provider");
    expect(normalized).toContain("self-hosted identity store");
  });

  it("resolves all probe artifacts to a single relative probe directory", () => {
    const artifacts = loadProbeArtifacts(PROBE_RESULTS_ROOT);
    const probePaths = new Set(
      artifacts.map((artifact) =>
        relative(PROBE_RESULTS_ROOT, artifact.path).replaceAll("\\", "/"),
      ),
    );

    expect(probePaths.size).toBe(5);
    for (const probePath of probePaths) {
      expect(
        probePath.startsWith(".."),
        `probe artifact ${probePath} escaped the probe-results directory`,
      ).toBe(false);
      expect(
        probePath.endsWith(".md"),
        `probe artifact ${probePath} is not a markdown file`,
      ).toBe(true);
    }
  });
});
