import { beforeEach, describe, expect, it } from "vitest";
import { useNavSidebar } from "./useNavSidebar";

describe("useNavSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    useNavSidebar.setState({ isNavExpanded: true });
  });

  it("defaults to expanded", () => {
    expect(useNavSidebar.getState().isNavExpanded).toBe(true);
  });

  it("toggleNav flips the expanded state", () => {
    useNavSidebar.getState().toggleNav();
    expect(useNavSidebar.getState().isNavExpanded).toBe(false);
    useNavSidebar.getState().toggleNav();
    expect(useNavSidebar.getState().isNavExpanded).toBe(true);
  });

  it("setNavExpanded sets the value explicitly", () => {
    useNavSidebar.getState().setNavExpanded(false);
    expect(useNavSidebar.getState().isNavExpanded).toBe(false);
  });

  it("persists the preference to localStorage", () => {
    useNavSidebar.getState().setNavExpanded(false);
    const raw = localStorage.getItem("nexus-nav-sidebar");
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? "{}");
    expect(stored.state.isNavExpanded).toBe(false);
  });
});
