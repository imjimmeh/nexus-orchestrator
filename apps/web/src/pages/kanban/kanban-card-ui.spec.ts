import { describe, expect, it } from "vitest";
import { parseDecisionMetadata } from "./kanban-card-ui";

describe("parseDecisionMetadata", () => {
  it("returns null for null metadata", () => {
    expect(parseDecisionMetadata(null)).toBeNull();
  });

  it("returns null for undefined metadata", () => {
    expect(parseDecisionMetadata(undefined)).toBeNull();
  });

  it("returns null for non-object metadata", () => {
    expect(
      parseDecisionMetadata("string" as unknown as Record<string, unknown>),
    ).toBeNull();
    expect(
      parseDecisionMetadata(42 as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it("extracts feedback needed fields", () => {
    const result = parseDecisionMetadata({
      feedbackNeeded: true,
      decisionPrompt: "Should this be preserved?",
      humanDecisionPolicy: "ask_when_uncertain",
    });

    expect(result).toMatchObject({
      feedbackNeeded: true,
      decisionPrompt: "Should this be preserved?",
    });
  });

  it("extracts autonomous decision fields", () => {
    const result = parseDecisionMetadata({
      autonomousDecision: true,
      resolutionRationale: "Autonomous mode resolved this.",
      humanDecisionPolicy: "decide_without_approval",
    });

    expect(result).toMatchObject({
      autonomousDecision: true,
      resolutionRationale: "Autonomous mode resolved this.",
    });
  });

  it("extracts user override fields including currentDisposition and lastGeneratedStatus", () => {
    const result = parseDecisionMetadata({
      userStatusOverride: true,
      generatedRecommendation: "blocked",
      currentDisposition: "todo",
      lastGeneratedStatus: "blocked",
    });

    expect(result).toMatchObject({
      userStatusOverride: true,
      generatedRecommendation: "blocked",
      currentDisposition: "todo",
      lastGeneratedStatus: "blocked",
    });
  });

  it("coerces wrong-typed boolean fields to false", () => {
    const result = parseDecisionMetadata({
      feedbackNeeded: "yes",
      autonomousDecision: 1,
      userStatusOverride: "true",
    });

    expect(result).toMatchObject({
      feedbackNeeded: false,
      autonomousDecision: false,
      userStatusOverride: false,
    });
  });

  it("coerces wrong-typed string fields to null", () => {
    const result = parseDecisionMetadata({
      decisionPrompt: 123,
      resolutionRationale: true,
      generatedRecommendation: null,
      currentDisposition: {},
      lastGeneratedStatus: [],
    });

    expect(result).toMatchObject({
      decisionPrompt: null,
      resolutionRationale: null,
      generatedRecommendation: null,
      currentDisposition: null,
      lastGeneratedStatus: null,
    });
  });

  it("returns all fields with defaults when metadata is an empty object", () => {
    const result = parseDecisionMetadata({});

    expect(result).toMatchObject({
      feedbackNeeded: false,
      decisionPrompt: null,
      autonomousDecision: false,
      resolutionRationale: null,
      userStatusOverride: false,
      generatedRecommendation: null,
      currentDisposition: null,
      lastGeneratedStatus: null,
    });
  });

  it("ignores unknown keys", () => {
    const result = parseDecisionMetadata({
      feedbackNeeded: true,
      decisionPrompt: "test",
      unknownKey: "ignored",
    });

    expect(result).toMatchObject({
      feedbackNeeded: true,
      decisionPrompt: "test",
    });
    expect(result).not.toHaveProperty("unknownKey");
  });
});
