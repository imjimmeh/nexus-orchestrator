import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKFLOW_ACTIVITY_FILTERS,
  type WorkflowActivityFeedFilters,
} from "@/components/workflow/WorkflowActivityFeed";
import {
  ACTIVITY_FILTER_QUERY_KEYS,
  applyActivityFiltersToSearchParams,
  parseBooleanFilterParam,
  toActivityFilters,
  toQuickType,
} from "./workflow-run-detail.activity-filters";

const QUICK_TYPE_KEY = ACTIVITY_FILTER_QUERY_KEYS.quickType;

const representativeFilters: WorkflowActivityFeedFilters = {
  searchQuery: "test_tool",
  showWorkflowEvents: false,
  showToolEvents: true,
  showFailuresOnly: true,
  quickType: "tool",
};

describe("workflow-run-detail.activity-filters", () => {
  describe("toActivityFilters", () => {
    it("returns the canonical defaults when no params are present", () => {
      expect(toActivityFilters(new URLSearchParams())).toEqual(
        DEFAULT_WORKFLOW_ACTIVITY_FILTERS,
      );
    });

    it("parses the search query from the evq key", () => {
      const params = new URLSearchParams();
      params.set(ACTIVITY_FILTER_QUERY_KEYS.search, "test_tool");

      expect(toActivityFilters(params).searchQuery).toBe("test_tool");
    });

    it("parses showWorkflowEvents=false from evwf=0", () => {
      const params = new URLSearchParams();
      params.set(ACTIVITY_FILTER_QUERY_KEYS.showWorkflowEvents, "0");

      expect(toActivityFilters(params).showWorkflowEvents).toBe(false);
    });

    it("parses showToolEvents=false from evtl=0", () => {
      const params = new URLSearchParams();
      params.set(ACTIVITY_FILTER_QUERY_KEYS.showToolEvents, "0");

      expect(toActivityFilters(params).showToolEvents).toBe(false);
    });

    it("parses showFailuresOnly=true from evf=1", () => {
      const params = new URLSearchParams();
      params.set(ACTIVITY_FILTER_QUERY_KEYS.showFailuresOnly, "1");

      expect(toActivityFilters(params).showFailuresOnly).toBe(true);
    });

    it("parses quickType=tool from evt=tool", () => {
      const params = new URLSearchParams();
      params.set(QUICK_TYPE_KEY, "tool");

      expect(toActivityFilters(params).quickType).toBe("tool");
    });
  });

  describe("toQuickType", () => {
    it("falls back to 'all' for unknown values", () => {
      expect(toQuickType("banana")).toBe("all");
    });

    it("falls back to 'all' when value is null", () => {
      expect(toQuickType(null)).toBe("all");
    });

    it("returns the value when it matches a known quick type", () => {
      expect(toQuickType("tool")).toBe("tool");
      expect(toQuickType("step")).toBe("step");
      expect(toQuickType("error")).toBe("error");
      expect(toQuickType("completion")).toBe("completion");
      expect(toQuickType("question")).toBe("question");
      expect(toQuickType("system")).toBe("system");
    });

    it("propagates the unknown-fallback behavior through toActivityFilters", () => {
      const params = new URLSearchParams();
      params.set(QUICK_TYPE_KEY, "banana");

      expect(toActivityFilters(params).quickType).toBe("all");
    });
  });

  describe("parseBooleanFilterParam", () => {
    it("returns the fallback when the value is null", () => {
      expect(parseBooleanFilterParam(null, true)).toBe(true);
      expect(parseBooleanFilterParam(null, false)).toBe(false);
    });

    it("treats '0' as false regardless of fallback", () => {
      expect(parseBooleanFilterParam("0", true)).toBe(false);
      expect(parseBooleanFilterParam("0", false)).toBe(false);
    });

    it("treats 'false' as false regardless of fallback", () => {
      expect(parseBooleanFilterParam("false", true)).toBe(false);
      expect(parseBooleanFilterParam("false", false)).toBe(false);
    });

    it("treats '1' as true regardless of fallback", () => {
      expect(parseBooleanFilterParam("1", true)).toBe(true);
      expect(parseBooleanFilterParam("1", false)).toBe(true);
    });

    it("treats 'true' as true regardless of fallback", () => {
      expect(parseBooleanFilterParam("true", true)).toBe(true);
      expect(parseBooleanFilterParam("true", false)).toBe(true);
    });
  });

  describe("applyActivityFiltersToSearchParams", () => {
    it("round-trips a representative non-default filter payload", () => {
      const url = applyActivityFiltersToSearchParams(
        new URLSearchParams(),
        representativeFilters,
      );
      const parsed = toActivityFilters(url);

      expect(parsed).toEqual(representativeFilters);
    });

    it("does not mutate the input URLSearchParams object", () => {
      const input = new URLSearchParams();
      input.append("preexisting", "keep");

      const before = input.toString();
      applyActivityFiltersToSearchParams(input, representativeFilters);
      const after = input.toString();

      expect(after).toBe(before);
      expect(input.has(ACTIVITY_FILTER_QUERY_KEYS.search)).toBe(false);
      expect(input.has(ACTIVITY_FILTER_QUERY_KEYS.showWorkflowEvents)).toBe(
        false,
      );
      expect(input.has(ACTIVITY_FILTER_QUERY_KEYS.showToolEvents)).toBe(false);
      expect(input.has(ACTIVITY_FILTER_QUERY_KEYS.showFailuresOnly)).toBe(
        false,
      );
      expect(input.has(QUICK_TYPE_KEY)).toBe(false);
    });

    it("preserves unrelated query parameters already present on the input", () => {
      const input = new URLSearchParams();
      input.append("workflowId", "wf-1");
      input.append("preexisting", "keep");

      const next = applyActivityFiltersToSearchParams(
        input,
        representativeFilters,
      );

      expect(next.get("workflowId")).toBe("wf-1");
      expect(next.get("preexisting")).toBe("keep");
      expect(next.get(ACTIVITY_FILTER_QUERY_KEYS.search)).toBe("test_tool");
      expect(next.get(QUICK_TYPE_KEY)).toBe("tool");
    });
  });
});
