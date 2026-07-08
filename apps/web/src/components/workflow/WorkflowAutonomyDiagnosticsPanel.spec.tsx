import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowRunAutonomyDiagnostics } from "@/lib/api/workflow-lifecycle.types";
import { WorkflowAutonomyDiagnosticsPanel } from "./WorkflowAutonomyDiagnosticsPanel";

describe("WorkflowAutonomyDiagnosticsPanel", () => {
  it("renders classification denied diagnostics with evidence and next steps", () => {
    const diagnostics: WorkflowRunAutonomyDiagnostics = {
      items: [
        {
          category: "failure_classification",
          title: "Failure classification: credential_missing",
          status: "denied",
          occurredAt: "2026-04-01T00:00:00.000Z",
          summary:
            "Class: credential_missing. Confidence: 0.99. Reason: API key missing.",
          evidence: [
            {
              kind: "runtime_diagnostic",
              id: "diag-1",
              summary: "Runtime diagnostic captured.",
            },
          ],
          nextSteps: [
            { label: "Escalate to a human operator", severity: "error" },
          ],
        },
      ],
    };

    render(<WorkflowAutonomyDiagnosticsPanel diagnostics={diagnostics} />);

    expect(screen.getByText("Autonomy Diagnostics")).toBeTruthy();
    expect(screen.getByText("failure_classification")).toBeTruthy();
    expect(screen.getByText("denied")).toBeTruthy();
    expect(
      screen.getByText("Failure classification: credential_missing"),
    ).toBeTruthy();
    expect(screen.getByText(/API key missing/)).toBeTruthy();
    expect(screen.getByText("runtime_diagnostic: diag-1")).toBeTruthy();
    expect(screen.getByText("Runtime diagnostic captured.")).toBeTruthy();
    expect(screen.getByText("Escalate to a human operator")).toBeTruthy();
  });

  it("renders repair dispatched and failed diagnostics", () => {
    const diagnostics: WorkflowRunAutonomyDiagnostics = {
      items: [
        {
          category: "repair",
          title:
            "Repair delegation: doctor.runtime_artifact.refresh_stale_artifacts",
          status: "in_progress",
          summary:
            "Policy action: doctor.runtime_artifact.refresh_stale_artifacts. Execution path: doctor. Attempt: 1",
          evidence: [],
          nextSteps: [],
        },
        {
          category: "repair",
          title: "Repair delegation: repair.config.create_local_placeholder",
          status: "failed",
          summary:
            "Policy action: repair.config.create_local_placeholder. Execution path: sysadmin_workflow. Attempt: 2",
          evidence: [
            { kind: "job_output", id: "job-1", summary: "Failed job output." },
          ],
          nextSteps: [
            {
              label: "Inspect repair output and retry manually if safe",
              severity: "error",
            },
          ],
        },
      ],
    };

    render(<WorkflowAutonomyDiagnosticsPanel diagnostics={diagnostics} />);

    expect(screen.getByText("in_progress")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("job_output: job-1")).toBeTruthy();
    expect(
      screen.getByText("Inspect repair output and retry manually if safe"),
    ).toBeTruthy();
  });

  it("renders the empty state", () => {
    render(<WorkflowAutonomyDiagnosticsPanel diagnostics={{ items: [] }} />);

    expect(
      screen.getByText("No autonomy diagnostics recorded for this run."),
    ).toBeTruthy();
  });
});
