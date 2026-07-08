// apps/web/src/components/scope/ScopeBreadcrumb.tsx
import { Globe } from "lucide-react";
import { useScopeContext } from "@/context/ScopeContext";

interface ScopeBreadcrumbProps {
  /** Override path — use when displaying a resource's own scope rather than the active scope */
  path?: string[];
}

export function ScopeBreadcrumb({ path }: ScopeBreadcrumbProps) {
  const { activeScopePath } = useScopeContext();
  const displayPath = path ?? activeScopePath;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Globe className="h-3 w-3" />
      {displayPath.map((segment, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span>›</span>}
          <span
            className={
              i === displayPath.length - 1
                ? "font-medium text-foreground"
                : "hover:text-foreground cursor-pointer hover:underline"
            }
          >
            {segment}
          </span>
        </span>
      ))}
    </div>
  );
}
