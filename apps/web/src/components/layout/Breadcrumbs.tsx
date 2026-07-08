import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { useProjectList } from "@/hooks/useProjects";
import { useWorkflows } from "@/hooks/useWorkflows";
import { findNavItemByPath } from "./navigation.config";

interface Crumb {
  label: string;
  path: string;
}

function prettifySegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

export function Breadcrumbs() {
  const location = useLocation();
  const { data: projects = [] } = useProjectList();
  const { data: workflows = [] } = useWorkflows();
  const segments = location.pathname.split("/").filter(Boolean);

  const crumbs = useMemo<Crumb[]>(() => {
    if (segments.length === 0) {
      return [];
    }

    const built: Crumb[] = [];

    segments.forEach((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join("/")}`;
      const navLabel = findNavItemByPath(path)?.label;
      const isUuidLike = /^[0-9a-fA-F-]{8,}$/.test(segment);
      const previous = segments[index - 1];

      let label = navLabel ?? prettifySegment(segment);
      if (isUuidLike && previous === "projects") {
        label =
          projects.find((project) => project.id === segment)?.name ?? "Project";
      }
      if (isUuidLike && previous === "workflows") {
        label =
          workflows.find((workflow) => workflow.id === segment)?.name ??
          "Workflow";
      }

      built.push({ label, path });
    });

    return built;
  }, [projects, segments, workflows]);

  if (crumbs.length === 0) {
    return null;
  }

  return (
    <nav
      className="border-b border-border/60 bg-card/60 px-6 py-1.5 lg:px-8"
      aria-label="Breadcrumb"
    >
      <ol className="flex items-center gap-1 text-xs text-muted-foreground">
        <li>
          <Link
            to="/"
            className="inline-flex items-center rounded p-1 hover:bg-muted hover:text-foreground"
          >
            <Home className="h-3.5 w-3.5" />
            <span className="sr-only">Home</span>
          </Link>
        </li>
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          return (
            <Fragment key={crumb.path}>
              <li>
                <ChevronRight className="h-3 w-3" />
              </li>
              <li>
                {isCurrent ? (
                  <span
                    className="max-w-[220px] truncate font-medium text-foreground"
                    title={crumb.label}
                    aria-current="page"
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.path}
                    className="max-w-[220px] truncate rounded px-1 py-0.5 hover:bg-muted hover:text-foreground"
                    title={crumb.label}
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
