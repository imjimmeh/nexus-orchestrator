import { describe, expect, it } from "vitest";
import {
  formatDateTimeSafe,
  formatDistanceToNowSafe,
  formatDateSafe,
} from "./utils";

describe("utils date helpers", () => {
  it("returns fallback text for invalid relative dates", () => {
    expect(formatDistanceToNowSafe("not-a-date", "recently")).toBe("recently");
  });

  it("returns fallback text for invalid formatted dates", () => {
    expect(formatDateSafe("not-a-date", "MMM d, yyyy", "Unknown date")).toBe(
      "Unknown date",
    );
    expect(formatDateTimeSafe("not-a-date", "Unknown time")).toBe(
      "Unknown time",
    );
  });
});
