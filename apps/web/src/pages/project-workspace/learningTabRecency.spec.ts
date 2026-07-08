import { beforeEach, describe, expect, it } from "vitest";
import {
  getLastViewedAt,
  isNewSinceLastVisit,
  isStalePending,
  markViewedNow,
} from "./learningTabRecency";

describe("learningTabRecency", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing has been viewed yet", () => {
    expect(getLastViewedAt("project-1")).toBeNull();
  });

  it("stores and retrieves a per-project last-viewed timestamp", () => {
    markViewedNow("project-1");

    const lastViewed = getLastViewedAt("project-1");
    expect(lastViewed).not.toBeNull();
    expect(new Date(lastViewed as string).getTime()).not.toBeNaN();
  });

  it("keeps last-viewed timestamps independent per project", () => {
    markViewedNow("project-1");

    expect(getLastViewedAt("project-2")).toBeNull();
  });

  describe("isNewSinceLastVisit", () => {
    it("is true when there is no prior visit at all", () => {
      expect(isNewSinceLastVisit("2026-06-30T00:00:00.000Z", null)).toBe(true);
    });

    it("is true when the item's timestamp is after the last visit", () => {
      expect(
        isNewSinceLastVisit(
          "2026-06-30T00:00:00.000Z",
          "2026-06-29T00:00:00.000Z",
        ),
      ).toBe(true);
    });

    it("is false when the item's timestamp is before the last visit", () => {
      expect(
        isNewSinceLastVisit(
          "2026-06-28T00:00:00.000Z",
          "2026-06-29T00:00:00.000Z",
        ),
      ).toBe(false);
    });
  });

  describe("isStalePending", () => {
    const now = new Date("2026-07-10T00:00:00.000Z");

    it("is true when a pending item is older than 7 days by default", () => {
      expect(isStalePending("pending", "2026-07-01T00:00:00.000Z", now)).toBe(
        true,
      );
    });

    it("is false when a pending item is within 7 days", () => {
      expect(isStalePending("pending", "2026-07-05T00:00:00.000Z", now)).toBe(
        false,
      );
    });

    it("is false for non-pending statuses regardless of age", () => {
      expect(isStalePending("rejected", "2026-06-01T00:00:00.000Z", now)).toBe(
        false,
      );
    });

    it("respects a custom staleDays threshold", () => {
      expect(
        isStalePending("pending", "2026-07-08T00:00:00.000Z", now, 1),
      ).toBe(true);
    });
  });
});
