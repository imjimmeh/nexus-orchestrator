import {
  Activity,
  Bell,
  Brain,
  BookOpen,
  Bot,
  ClipboardList,
  Container,
  Database,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  Key,
  MessagesSquare,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Timer,
  Users,
  Wrench,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { AppPlane } from "@/lib/scope/plane.types";

type NavItem = {
  label: string;
  icon: LucideIcon;
  path: string;
  /** Which plane(s) show this item. Omit for plane-agnostic ("both"). */
  plane?: AppPlane | "both";
  /** Permission (at the active scope) required to show this item. */
  requiredPermission?: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
  /** Which plane(s) show this group. Omit for plane-agnostic ("both"). */
  plane?: AppPlane | "both";
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Work",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/" },
      {
        label: "Projects",
        icon: FolderKanban,
        path: "/projects",
        plane: "workspace",
      },
      {
        label: "Work Items",
        icon: ClipboardList,
        path: "/work-items",
        plane: "workspace",
      },
      {
        label: "Sessions",
        icon: MessagesSquare,
        path: "/sessions",
        plane: "workspace",
      },
      { label: "Memories", icon: Brain, path: "/memory", plane: "workspace" },
      { label: "Notifications", icon: Bell, path: "/notifications" },
    ],
  },
  {
    title: "Automation",
    items: [
      {
        label: "Workflows",
        icon: Workflow,
        path: "/workflows",
        plane: "workspace",
        requiredPermission: "workflows:read",
      },
      {
        label: "Schedules",
        icon: Timer,
        path: "/schedules",
        plane: "workspace",
      },
      { label: "Events", icon: Activity, path: "/events", plane: "workspace" },
      { label: "Doctor", icon: Stethoscope, path: "/operations/doctor" },
    ],
  },
  {
    title: "Configuration",
    items: [
      {
        label: "Agents",
        icon: Bot,
        path: "/agents",
        plane: "workspace",
        requiredPermission: "agents:read",
      },
      {
        label: "Skills",
        icon: BookOpen,
        path: "/agent-skills",
        plane: "workspace",
        requiredPermission: "skills:read",
      },
      {
        label: "Improvements",
        icon: Sparkles,
        path: "/improvements",
        plane: "workspace",
        requiredPermission: "improvements:read",
      },
      {
        label: "Providers",
        icon: Database,
        path: "/providers",
        plane: "platform",
      },
      { label: "Tools", icon: Wrench, path: "/tools", plane: "workspace" },
      {
        label: "Secrets",
        icon: Key,
        path: "/secrets",
        plane: "workspace",
        requiredPermission: "secrets:read",
      },
      {
        label: "Variables",
        icon: SlidersHorizontal,
        path: "/variables",
        plane: "workspace",
        requiredPermission: "settings:read",
      },
      {
        label: "Settings",
        icon: Settings,
        path: "/settings",
        plane: "workspace",
      },
    ],
  },
  {
    title: "Administration",
    plane: "platform",
    items: [
      {
        label: "Users",
        icon: Users,
        path: "/users",
        requiredPermission: "users:read",
      },
      {
        label: "Budget",
        icon: Database,
        path: "/admin/budget-policies",
        requiredPermission: "budgets:read",
      },
      {
        label: "GitOps",
        icon: GitBranch,
        path: "/gitops",
        requiredPermission: "gitops:read",
      },
      { label: "Harnesses", icon: Container, path: "/admin/harnesses" },
      {
        label: "Audit",
        icon: ShieldAlert,
        path: "/audit",
        requiredPermission: "audit:read",
      },
    ],
  },
];

const NAV_ITEM_BY_PATH = new Map(
  NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.path, item])),
);

const NAV_ORDER = NAV_GROUPS.flatMap((group) => group.items).map(
  (item) => item.path,
);

export function findNavItemByPath(pathname: string) {
  const direct = NAV_ITEM_BY_PATH.get(pathname);
  if (direct) {
    return direct;
  }

  const bestPrefix = NAV_ORDER.filter(
    (path) => path !== "/" && pathname.startsWith(path),
  ).sort((a, b) => b.length - a.length)[0];

  if (!bestPrefix) {
    return undefined;
  }

  return NAV_ITEM_BY_PATH.get(bestPrefix);
}

const MANAGE_ACTION = "manage";

/**
 * Returns true when `permissions` grants `required`, either directly or via
 * the `<resource>:manage` wildcard (e.g. `agents:manage` implies `agents:read`).
 * Mirrors `evaluateCan` in `useMyPermissions` for the nav-filtering call site.
 */
function satisfies(permissions: readonly string[], required: string): boolean {
  if (permissions.includes(required)) return true;
  const [resource] = required.split(":");
  return permissions.includes(`${resource}:${MANAGE_ACTION}`);
}

function matchesPlane(
  itemPlane: AppPlane | "both" | undefined,
  plane: AppPlane,
) {
  return itemPlane === undefined || itemPlane === "both" || itemPlane === plane;
}

export function filterNavGroupsByRole(
  groups: NavGroup[],
  isAdmin: boolean,
  plane: AppPlane,
  permissions: string[],
): NavGroup[] {
  return groups
    .filter((group) => matchesPlane(group.plane, plane))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!matchesPlane(item.plane, plane)) return false;
        if (item.requiredPermission) {
          // A platform admin always sees permission-gated items even if
          // /me/permissions returns empty in the browser (e.g. stale JWT) —
          // pre-Phase-5 these showed on isAdmin alone.
          return isAdmin || satisfies(permissions, item.requiredPermission);
        }
        // Legacy admin fallback: any platform-plane item without an explicit
        // permission (including all Administration-group items, which are
        // platform-only) is admin-only, so ungated admin CRUD surfaces such
        // as Providers are never exposed to non-admins.
        if (item.plane === "platform" || group.plane === "platform") {
          return isAdmin;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}
