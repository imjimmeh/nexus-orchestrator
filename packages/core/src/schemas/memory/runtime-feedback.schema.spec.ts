import { describe, expect, it } from "vitest";
import {
  runtimeFeedbackSignalSchema,
  runtimeFeedbackSignalTypeSchema,
} from "./runtime-feedback.schema";

describe("runtime feedback schemas", () => {
  it("accepts a normalized tool contract repair signal", () => {
    expect(
      runtimeFeedbackSignalSchema.parse({
        signal_type: "tool_contract_repair",
        source_module: "tool-runtime",
        scope: { scope_type: "workflow_run", scope_id: "run-1" },
        actor: { agent_profile: "sysadmin" },
        affected: {
          tool_name: "set_job_output",
          workflow_id: "workflow-1",
          schema_path: "data",
        },
        evidence: [
          {
            kind: "event_ledger",
            id: "event-1",
            summary: "Tool contract repair threshold exceeded.",
          },
        ],
        examples: [
          {
            summary: "data was supplied as a JSON string.",
            redacted: true,
          },
        ],
        confidence: 0.9,
        severity: "medium",
        dedupe_fingerprint: "tool:set_job_output:data",
        occurred_at: "2026-05-17T00:00:00.000Z",
      }),
    ).toMatchObject({
      signal_type: "tool_contract_repair",
      source_module: "tool-runtime",
      severity: "medium",
    });
  });

  it("rejects raw or unredacted examples", () => {
    expect(() =>
      runtimeFeedbackSignalSchema.parse({
        signal_type: "tool_contract_repair",
        source_module: "tool-runtime",
        scope: { scope_type: "workflow_run", scope_id: "run-1" },
        evidence: [
          { kind: "event_ledger", id: "event-1", summary: "Evidence." },
        ],
        examples: [{ summary: "api_key=secret", redacted: false }],
        confidence: 0.9,
        severity: "medium",
        dedupe_fingerprint: "fingerprint",
      }),
    ).toThrow();

    expect(() =>
      runtimeFeedbackSignalSchema.parse({
        signal_type: "tool_contract_repair",
        source_module: "tool-runtime",
        scope: { scope_type: "workflow_run", scope_id: "run-1" },
        evidence: [
          { kind: "event_ledger", id: "event-1", summary: "Evidence." },
        ],
        examples: [{ summary: "safe", redacted: true, raw_payload: "secret" }],
        confidence: 0.9,
        severity: "medium",
        dedupe_fingerprint: "fingerprint",
      }),
    ).toThrow();
  });

  it("rejects unknown evidence fields", () => {
    expect(() =>
      runtimeFeedbackSignalSchema.parse({
        signal_type: "tool_contract_repair",
        source_module: "tool-runtime",
        scope: { scope_type: "workflow_run", scope_id: "run-1" },
        evidence: [
          {
            kind: "event_ledger",
            id: "event-1",
            summary: "Evidence.",
            raw_payload: "secret",
          },
        ],
        confidence: 0.9,
        severity: "medium",
        dedupe_fingerprint: "fingerprint",
      }),
    ).toThrow();
  });

  it("rejects unknown actor and affected fields", () => {
    expect(() =>
      runtimeFeedbackSignalSchema.parse({
        signal_type: "tool_contract_repair",
        source_module: "tool-runtime",
        scope: { scope_type: "workflow_run", scope_id: "run-1" },
        actor: { agent_profile: "sysadmin", raw_payload: "secret" },
        affected: { tool_name: "set_job_output" },
        evidence: [
          { kind: "event_ledger", id: "event-1", summary: "Evidence." },
        ],
        confidence: 0.9,
        severity: "medium",
        dedupe_fingerprint: "fingerprint",
      }),
    ).toThrow();

    expect(() =>
      runtimeFeedbackSignalSchema.parse({
        signal_type: "tool_contract_repair",
        source_module: "tool-runtime",
        scope: { scope_type: "workflow_run", scope_id: "run-1" },
        actor: { agent_profile: "sysadmin" },
        affected: { tool_name: "set_job_output", raw_payload: "secret" },
        evidence: [
          { kind: "event_ledger", id: "event-1", summary: "Evidence." },
        ],
        confidence: 0.9,
        severity: "medium",
        dedupe_fingerprint: "fingerprint",
      }),
    ).toThrow();
  });

  it("rejects missing source, scope, evidence, and fingerprint", () => {
    expect(() =>
      runtimeFeedbackSignalSchema.parse({
        signal_type: "repair_outcome",
        confidence: 0.8,
        severity: "low",
      }),
    ).toThrow();
  });

  it("pins initial signal types", () => {
    expect(runtimeFeedbackSignalTypeSchema.options).toEqual([
      "tool_contract_repair",
      "failure_classification",
      "repair_outcome",
      "workflow_anomaly",
      "review_qa_finding",
      "memory_miss",
    ]);
  });
});
