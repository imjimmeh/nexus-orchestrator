// apps/web/src/components/layout/navigation.config.spec.ts
import { describe, it, expect } from "vitest";
import { NAV_GROUPS, filterNavGroupsByRole } from "./navigation.config";

describe("filterNavGroupsByRole", () => {
  it("hides platform-only groups in the workspace plane", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, true, "workspace", [
      "workflows:read",
    ]);
    expect(out.find((g) => g.title === "Administration")).toBeUndefined();
  });

  it("shows platform admin surfaces in the platform plane for an admin", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, true, "platform", []);
    expect(out.find((g) => g.title === "Administration")).toBeDefined();
  });

  it("filters items by effective permission at the active scope", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, false, "workspace", [
      "workflows:read",
    ]);
    const automation = out.find((g) => g.title === "Automation");
    expect(automation?.items.some((i) => i.path === "/workflows")).toBe(true);
  });

  it("treats <resource>:manage as satisfying <resource>:read", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, false, "workspace", [
      "agents:manage",
    ]);
    const config = out.find((g) => g.title === "Configuration");
    expect(config?.items.some((i) => i.path === "/agents")).toBe(true);
  });

  it("hides a permission-gated item when the permission is absent", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, false, "workspace", []);
    const automation = out.find((g) => g.title === "Automation");
    expect(automation?.items.some((i) => i.path === "/workflows")).toBe(false);
  });

  it("shows a permission-gated item to a platform admin even when /me/permissions returns empty", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, true, "workspace", []);
    const automation = out.find((g) => g.title === "Automation");
    expect(automation?.items.some((i) => i.path === "/workflows")).toBe(true);
  });

  it("still hides a permission-gated item from a non-admin when permissions are empty", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, false, "workspace", []);
    const automation = out.find((g) => g.title === "Automation");
    expect(automation?.items.some((i) => i.path === "/workflows")).toBe(false);
  });

  it("hides platform-plane ungated items (Providers) from a non-admin at the platform plane", () => {
    const out = filterNavGroupsByRole(NAV_GROUPS, false, "platform", []);
    const allPaths = out.flatMap((g) => g.items.map((i) => i.path));
    expect(allPaths).not.toContain("/providers");
  });

  it("shows platform-plane ungated items (Providers) to an admin at the platform plane", () => {
    const config = filterNavGroupsByRole(NAV_GROUPS, true, "platform", []).find(
      (g) => g.title === "Configuration",
    );
    expect(config?.items.some((i) => i.path === "/providers")).toBe(true);
  });

  it("keeps legacy admin-gated behavior for Administration items without an explicit permission", () => {
    const admin = filterNavGroupsByRole(NAV_GROUPS, true, "platform", []).find(
      (g) => g.title === "Administration",
    );
    const nonAdmin = filterNavGroupsByRole(
      NAV_GROUPS,
      false,
      "platform",
      [],
    ).find((g) => g.title === "Administration");
    expect(admin?.items.length).toBeGreaterThan(0);
    expect(nonAdmin).toBeUndefined();
  });
});
