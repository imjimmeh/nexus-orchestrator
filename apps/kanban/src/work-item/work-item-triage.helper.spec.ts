import { describe, expect, it } from "vitest";
import { scoreTriage } from "./work-item-triage.helper";
import {
  TriageScore,
  TriageSignals,
  TriageTrack,
} from "./work-item-triage.types";

describe("scoreTriage", () => {
  it("classifies a tiny, few-AC item as trivial", () => {
    const r = scoreTriage({ description: "Fix typo in label.", acCount: 1 });
    expect(r.track).toBe("trivial");
    expect(r.ambiguous).toBe(false);
  });

  it("classifies a large, many-AC item as complex", () => {
    const r = scoreTriage({ description: "x".repeat(3000), acCount: 9 });
    expect(r.track).toBe("complex");
    expect(r.ambiguous).toBe(false);
  });

  it("classifies a mid-size item as standard", () => {
    const r = scoreTriage({ description: "x".repeat(1200), acCount: 5 });
    expect(r.track).toBe("standard");
  });

  it("flags ambiguous when signals straddle a boundary", () => {
    // few ACs (suggests trivial) but a long description (suggests >= standard)
    const r = scoreTriage({ description: "x".repeat(900), acCount: 2 });
    expect(r.ambiguous).toBe(true);
  });

  it("treats missing description as zero length", () => {
    const r = scoreTriage({ description: null, acCount: 0 });
    expect(r.track).toBe("trivial");
  });
});
