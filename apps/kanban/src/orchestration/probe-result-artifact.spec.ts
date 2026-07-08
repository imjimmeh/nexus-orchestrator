import { describe, expect, it } from "vitest";
import {
  parseProbeResultArtifact,
  validateSuccessfulProbeResultArtifact,
} from "./probe-result-artifact";

const successfulProbe = `---
project_scope_id: project-1
probe_scope_id: workflow-runtime
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts
source_paths:
  - apps/api/src/workflow/workflow-runtime
updated_at: 2026-05-09T10:00:00.000Z
---
# Probe Result: Workflow Runtime

## Narrative Summary
Workflow runtime exposes governed runtime actions for agent-facing workflow capabilities.

## Capability Updates
- Runtime actions are implemented.

## Health Findings
- No blocking issues found.

## Open Questions
- None.
`;

describe("ProbeResultArtifact", () => {
  it("extracts the canonical narrative summary from the markdown section", () => {
    const artifact = parseProbeResultArtifact(
      successfulProbe,
      "workflow-runtime.md",
    );

    expect(artifact.outcome).toBe("success");
    expect(artifact.inferredStatus).toBe("implemented");
    expect(artifact.confidenceScore).toBe(0.92);
    expect(artifact.narrativeSummary).toBe(
      "Workflow runtime exposes governed runtime actions for agent-facing workflow capabilities.",
    );
    expect(artifact.evidenceRefs).toEqual([
      "apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts",
    ]);
  });

  it("treats missing narrative summary section as invalid for successful probes", () => {
    const content = successfulProbe.replace(
      /## Narrative Summary[\s\S]*?## Capability Updates/,
      "## Capability Updates",
    );

    const result = validateSuccessfulProbeResultArtifact(
      content,
      "workflow-runtime.md",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingFields).toContain("narrative_summary");
    }
  });

  it("accepts legacy narrative_summary frontmatter when the section is absent", () => {
    const legacyProbe = `---
project_scope_id: project-1
probe_scope_id: workflow-runtime
outcome: success
inferred_status: implemented
confidence_score: 0.92
narrative_summary: Legacy machine-readable narrative.
evidence_refs:
  - apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts
source_paths:
  - apps/api/src/workflow/workflow-runtime
updated_at: 2026-05-09T10:00:00.000Z
---
# Probe Result: Workflow Runtime
`;

    const result = validateSuccessfulProbeResultArtifact(
      legacyProbe,
      "workflow-runtime.md",
    );

    expect(result.ok).toBe(true);
  });

  it("unquotes scalar frontmatter values before validation and classification", () => {
    const quotedProbe = `---
project_scope_id: 'project-1'
probe_scope_id: "workflow-runtime"
outcome: "success"
inferred_status: 'implemented'
confidence_score: "0.92"
narrative_summary: "Legacy machine-readable narrative."
evidence_refs:
  - apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts
---
# Probe Result: Workflow Runtime
`;

    const artifact = parseProbeResultArtifact(
      quotedProbe,
      "workflow-runtime.md",
    );
    const validation = validateSuccessfulProbeResultArtifact(
      quotedProbe,
      "workflow-runtime.md",
    );

    expect(artifact.outcome).toBe("success");
    expect(artifact.inferredStatus).toBe("implemented");
    expect(artifact.confidenceScore).toBe(0.92);
    expect(artifact.narrativeSummary).toBe(
      "Legacy machine-readable narrative.",
    );
    expect(validation.ok).toBe(true);
  });

  it("includes subsections under ## Narrative Summary until the next ## heading", () => {
    const probeWithSubsections = `---
project_scope_id: project-1
probe_scope_id: workflow-runtime
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts
source_paths:
  - apps/api/src/workflow/workflow-runtime
updated_at: 2026-05-09T10:00:00.000Z
---
# Probe Result: Workflow Runtime

## Narrative Summary
Top-level narrative text.

### Implementation Details
The runtime module exports governed actions.

### Edge Cases
Container lifecycle hooks are handled.

## Capability Updates
- Runtime actions are implemented.
`;

    const artifact = parseProbeResultArtifact(
      probeWithSubsections,
      "workflow-runtime.md",
    );

    expect(artifact.narrativeSummary).toContain("Top-level narrative text.");
    expect(artifact.narrativeSummary).toContain("### Implementation Details");
    expect(artifact.narrativeSummary).toContain(
      "The runtime module exports governed actions.",
    );
    expect(artifact.narrativeSummary).toContain("### Edge Cases");
    expect(artifact.narrativeSummary).not.toContain("## Capability Updates");
  });
});
